/**
 * Pune ZP AI WhatsApp Chatbot Widget
 * Embedded Widget for Government Website Integration
 * Version: 2.0.0
 * Date: 2025-06-24
 * Author: soft00null
 */

(function() {
    'use strict';
    
    // Widget Configuration
    const PUNE_ZP_CONFIG = {
        // WhatsApp Configuration
        phoneNumber: '912026134806',
        defaultMessage: 'नमस्कार! मला पुणे जिल्हा परिषदेच्या सेवांबद्दल माहिती हवी आहे। / Hello! I need information about Pune Zilla Panchayat services.',
        
        // AI Chatbot Configuration
        botName: 'पुणे जिप AI सहाय्यक / Pune ZP AI Assistant',
        department: 'पुणे जिल्हा परिषद / Pune Zilla Panchayat',
        
        // Widget Settings
        position: 'bottom-right',
        primaryColor: '#FF6B35', // Pune ZP Orange
        secondaryColor: '#2E8B57', // Government Green
        language: 'bilingual', // Marathi + English
        
        // QR Code API
        qrApiUrl: 'https://bwipjs-api.metafloor.com/?bcid=qrcode&text=',
        
        // Features
        showNotification: true,
        autoShow: true,
        showWorkingHours: true,
        enableAnalytics: true,
        
        // Working Hours
        workingHours: {
            enabled: true,
            timezone: 'Asia/Kolkata',
            schedule: {
                monday: { start: '10:00', end: '18:00' },
                tuesday: { start: '10:00', end: '18:00' },
                wednesday: { start: '10:00', end: '18:00' },
                thursday: { start: '10:00', end: '18:00' },
                friday: { start: '10:00', end: '18:00' },
                saturday: { start: '10:00', end: '14:00' },
                sunday: { closed: true }
            }
        }
    };

    // Utility Functions
    const Utils = {
        // Create unique ID
        generateId: () => 'pzp_' + Math.random().toString(36).substr(2, 9),
        
        // Check if element exists
        elementExists: (id) => document.getElementById(id) !== null,
        
        // Get current time in IST
        getCurrentTimeIST: () => {
            return new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour12: false
            });
        },
        
        // Check working hours
        isWorkingHours: () => {
            if (!PUNE_ZP_CONFIG.workingHours.enabled) return true;
            
            const now = new Date();
            const istTime = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Kolkata'}));
            const day = istTime.toLocaleDateString('en-US', {weekday: 'lowercase'});
            const currentTime = istTime.getHours() * 100 + istTime.getMinutes();
            
            const schedule = PUNE_ZP_CONFIG.workingHours.schedule[day];
            if (!schedule || schedule.closed) return false;
            
            const startTime = parseInt(schedule.start.replace(':', ''));
            const endTime = parseInt(schedule.end.replace(':', ''));
            
            return currentTime >= startTime && currentTime <= endTime;
        },
        
        // Analytics tracking
        track: (event, data = {}) => {
            if (!PUNE_ZP_CONFIG.enableAnalytics) return;
            
            // Google Analytics 4
            if (typeof gtag !== 'undefined') {
                gtag('event', event, {
                    event_category: 'Pune_ZP_WhatsApp_Widget',
                    event_label: data.label || 'user_interaction',
                    custom_parameter_1: data.extra || null
                });
            }
            
            // Custom analytics
            if (typeof _paq !== 'undefined') {
                _paq.push(['trackEvent', 'Pune ZP Widget', event, data.label]);
            }
            
            console.log('📊 Pune ZP Widget Analytics:', event, data);
        }
    };

    // Widget Class
    class PuneZPWhatsAppWidget {
        constructor() {
            this.widgetId = Utils.generateId();
            this.isOpen = false;
            this.isWorkingHours = Utils.isWorkingHours();
            
            // Prevent multiple instances
            if (Utils.elementExists('pune-zp-whatsapp-widget')) {
                console.warn('Pune ZP WhatsApp Widget already exists!');
                return;
            }
            
            this.init();
        }

        init() {
            this.injectStyles();
            this.createWidget();
            this.bindEvents();
            this.setupAutoShow();
            Utils.track('widget_initialized', { timestamp: Utils.getCurrentTimeIST() });
        }

        injectStyles() {
            const styles = `
                <style id="pune-zp-widget-styles">
                    /* Pune ZP WhatsApp Widget Styles */
                    .pzp-widget * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    }
                    
                    .pzp-widget {
                        position: fixed;
                        ${PUNE_ZP_CONFIG.position.includes('bottom') ? 'bottom' : 'top'}: 20px;
                        ${PUNE_ZP_CONFIG.position.includes('right') ? 'right' : 'left'}: 20px;
                        z-index: 999999;
                        font-size: 14px;
                    }
                    
                    .pzp-button {
                        width: 65px;
                        height: 65px;
                        background: linear-gradient(135deg, ${PUNE_ZP_CONFIG.primaryColor}, ${PUNE_ZP_CONFIG.secondaryColor});
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        box-shadow: 0 6px 25px rgba(255, 107, 53, 0.4);
                        transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                        position: relative;
                        overflow: hidden;
                        border: 3px solid rgba(255, 255, 255, 0.2);
                    }
                    
                    .pzp-button:hover {
                        transform: scale(1.1) rotate(5deg);
                        box-shadow: 0 8px 30px rgba(255, 107, 53, 0.6);
                    }
                    
                    .pzp-button::before {
                        content: '';
                        position: absolute;
                        top: -50%;
                        left: -50%;
                        width: 200%;
                        height: 200%;
                        background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
                        transform: rotate(45deg);
                        transition: all 0.5s;
                        opacity: 0;
                    }
                    
                    .pzp-button:hover::before {
                        animation: shimmer 0.6s ease-in-out;
                    }
                    
                    @keyframes shimmer {
                        0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); opacity: 0; }
                        50% { opacity: 1; }
                        100% { transform: translateX(100%) translateY(100%) rotate(45deg); opacity: 0; }
                    }
                    
                    .pzp-icon {
                        font-size: 30px;
                        color: white;
                        transition: transform 0.3s ease;
                    }
                    
                    .pzp-button:hover .pzp-icon {
                        transform: scale(1.1);
                    }
                    
                    .pzp-badge {
                        position: absolute;
                        top: -8px;
                        right: -8px;
                        background: #FF3333;
                        color: white;
                        border-radius: 50%;
                        width: 24px;
                        height: 24px;
                        font-size: 11px;
                        font-weight: bold;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        animation: pulse 2s infinite;
                        border: 2px solid white;
                    }
                    
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.2); }
                    }
                    
                    .pzp-modal {
                        position: absolute;
                        ${PUNE_ZP_CONFIG.position.includes('bottom') ? 'bottom' : 'top'}: 85px;
                        ${PUNE_ZP_CONFIG.position.includes('right') ? 'right' : 'left'}: 0;
                        width: 380px;
                        max-width: calc(100vw - 30px);
                        background: white;
                        border-radius: 24px;
                        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                        transform: translateY(20px) scale(0.8);
                        opacity: 0;
                        visibility: hidden;
                        transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                        overflow: hidden;
                        border: 1px solid rgba(255, 107, 53, 0.2);
                    }
                    
                    .pzp-modal.active {
                        transform: translateY(0) scale(1);
                        opacity: 1;
                        visibility: visible;
                    }
                    
                    .pzp-header {
                        background: linear-gradient(135deg, ${PUNE_ZP_CONFIG.primaryColor}, ${PUNE_ZP_CONFIG.secondaryColor});
                        color: white;
                        padding: 25px 20px;
                        position: relative;
                        overflow: hidden;
                    }
                    
                    .pzp-header::before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="2" fill="rgba(255,255,255,0.1)"/><circle cx="80" cy="30" r="1.5" fill="rgba(255,255,255,0.1)"/><circle cx="40" cy="70" r="1" fill="rgba(255,255,255,0.1)"/><circle cx="70" cy="80" r="2.5" fill="rgba(255,255,255,0.05)"/></svg>');
                    }
                    
                    .pzp-header-content {
                        position: relative;
                        z-index: 1;
                    }
                    
                    .pzp-title {
                        font-size: 18px;
                        font-weight: 700;
                        margin-bottom: 8px;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .pzp-subtitle {
                        font-size: 13px;
                        opacity: 0.95;
                        line-height: 1.4;
                    }
                    
                    .pzp-status {
                        position: absolute;
                        top: 20px;
                        right: 20px;
                        background: ${Utils.isWorkingHours() ? '#4CAF50' : '#FF9800'};
                        color: white;
                        padding: 4px 8px;
                        border-radius: 12px;
                        font-size: 10px;
                        font-weight: 600;
                    }
                    
                    .pzp-close {
                        position: absolute;
                        top: 50%;
                        right: 50px;
                        transform: translateY(-50%);
                        background: rgba(255, 255, 255, 0.2);
                        border: none;
                        color: white;
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 16px;
                        transition: all 0.3s ease;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .pzp-close:hover {
                        background: rgba(255, 255, 255, 0.3);
                        transform: translateY(-50%) rotate(90deg);
                    }
                    
                    .pzp-body {
                        padding: 25px 20px;
                        background: #fafafa;
                    }
                    
                    .pzp-options {
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        margin-bottom: 20px;
                    }
                    
                    .pzp-option {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        padding: 16px;
                        background: white;
                        border: 2px solid #e0e0e0;
                        border-radius: 16px;
                        text-decoration: none;
                        color: #333;
                        transition: all 0.3s ease;
                        position: relative;
                        overflow: hidden;
                    }
                    
                    .pzp-option::before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: -100%;
                        width: 100%;
                        height: 100%;
                        background: linear-gradient(90deg, transparent, rgba(255, 107, 53, 0.1), transparent);
                        transition: left 0.5s;
                    }
                    
                    .pzp-option:hover {
                        border-color: ${PUNE_ZP_CONFIG.primaryColor};
                        background: #fff8f5;
                        transform: translateY(-3px);
                        box-shadow: 0 8px 25px rgba(255, 107, 53, 0.15);
                    }
                    
                    .pzp-option:hover::before {
                        left: 100%;
                    }
                    
                    .pzp-option-icon {
                        font-size: 28px;
                        width: 45px;
                        text-align: center;
                        color: ${PUNE_ZP_CONFIG.primaryColor};
                    }
                    
                    .pzp-option-content h3 {
                        font-size: 16px;
                        font-weight: 600;
                        color: #2c3e50;
                        margin-bottom: 4px;
                    }
                    
                    .pzp-option-content p {
                        font-size: 12px;
                        color: #7f8c8d;
                        line-height: 1.3;
                    }
                    
                    .pzp-qr-section {
                        background: white;
                        border-radius: 16px;
                        padding: 20px;
                        text-align: center;
                        border: 1px solid #e0e0e0;
                    }
                    
                    .pzp-qr-title {
                        font-size: 14px;
                        color: #555;
                        margin-bottom: 15px;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                    }
                    
                    .pzp-qr-container {
                        display: inline-block;
                        padding: 15px;
                        background: #f9f9f9;
                        border-radius: 16px;
                        transition: transform 0.3s ease;
                        border: 2px dashed #ddd;
                    }
                    
                    .pzp-qr-container:hover {
                        transform: scale(1.05);
                        border-color: ${PUNE_ZP_CONFIG.primaryColor};
                    }
                    
                    .pzp-qr-code {
                        width: 140px;
                        height: 140px;
                        border-radius: 12px;
                        display: block;
                    }
                    
                    .pzp-qr-instructions {
                        font-size: 11px;
                        color: #666;
                        margin-top: 12px;
                        line-height: 1.4;
                    }
                    
                    .pzp-footer {
                        padding: 15px 20px;
                        background: #f0f0f0;
                        border-top: 1px solid #e0e0e0;
                        text-align: center;
                        font-size: 11px;
                        color: #666;
                    }
                    
                    /* Responsive Design */
                    @media (max-width: 480px) {
                        .pzp-widget {
                            ${PUNE_ZP_CONFIG.position.includes('right') ? 'right' : 'left'}: 15px;
                            bottom: 15px;
                        }
                        
                        .pzp-modal {
                            width: calc(100vw - 30px);
                            ${PUNE_ZP_CONFIG.position.includes('right') ? 'right' : 'left'}: -10px;
                        }
                        
                        .pzp-button {
                            width: 60px;
                            height: 60px;
                        }
                        
                        .pzp-icon {
                            font-size: 26px;
                        }
                        
                        .pzp-qr-code {
                            width: 120px;
                            height: 120px;
                        }
                    }
                    
                    /* Dark mode support */
                    @media (prefers-color-scheme: dark) {
                        .pzp-modal {
                            background: #2c2c2c;
                            border-color: #444;
                        }
                        
                        .pzp-body {
                            background: #333;
                        }
                        
                        .pzp-option {
                            background: #3c3c3c;
                            border-color: #555;
                            color: #fff;
                        }
                        
                        .pzp-option:hover {
                            background: #444;
                        }
                        
                        .pzp-qr-section {
                            background: #3c3c3c;
                            border-color: #555;
                        }
                        
                        .pzp-footer {
                            background: #2a2a2a;
                            border-color: #444;
                            color: #aaa;
                        }
                    }
                    
                    /* Print styles */
                    @media print {
                        .pzp-widget {
                            display: none !important;
                        }
                    }
                </style>
            `;
            
            document.head.insertAdjacentHTML('beforeend', styles);
        }

        createWidget() {
            const workingStatus = this.isWorkingHours ? 
                'ऑनलाइन / Online' : 
                'ऑफलाइन / Offline';
            
            const whatsappUrl = `https://wa.me/${PUNE_ZP_CONFIG.phoneNumber}?text=${encodeURIComponent(PUNE_ZP_CONFIG.defaultMessage)}`;
            const webWhatsappUrl = `https://web.whatsapp.com/send?phone=${PUNE_ZP_CONFIG.phoneNumber}&text=${encodeURIComponent(PUNE_ZP_CONFIG.defaultMessage)}`;
            const qrCodeUrl = `${PUNE_ZP_CONFIG.qrApiUrl}${encodeURIComponent(whatsappUrl)}`;
            
            const widgetHTML = `
                <div class="pzp-widget" id="pune-zp-whatsapp-widget">
                    <div class="pzp-button" id="pzp-button">
                        <div class="pzp-icon">💬</div>
                        ${PUNE_ZP_CONFIG.showNotification ? '<div class="pzp-badge">AI</div>' : ''}
                    </div>
                    
                    <div class="pzp-modal" id="pzp-modal">
                        <div class="pzp-header">
                            <div class="pzp-status">${workingStatus}</div>
                            <div class="pzp-header-content">
                                <div class="pzp-title">
                                    🤖 ${PUNE_ZP_CONFIG.botName}
                                </div>
                                <div class="pzp-subtitle">
                                    ${PUNE_ZP_CONFIG.department}<br>
                                    सेवा, पारदर्शकता, जबाबदारी
                                </div>
                            </div>
                            <button class="pzp-close" id="pzp-close">✕</button>
                        </div>
                        
                        <div class="pzp-body">
                            <div class="pzp-options">
                                <a href="${whatsappUrl}" class="pzp-option" target="_blank" rel="noopener noreferrer">
                                    <div class="pzp-option-icon">📱</div>
                                    <div class="pzp-option-content">
                                        <h3>मोबाइल चॅट / Mobile Chat</h3>
                                        <p>तुमच्या फोनवर AI चॅटबॉटशी गप्पा मारा</p>
                                    </div>
                                </a>
                                
                                <a href="${webWhatsappUrl}" class="pzp-option" target="_blank" rel="noopener noreferrer">
                                    <div class="pzp-option-icon">💻</div>
                                    <div class="pzp-option-content">
                                        <h3>वेब चॅट / Web Chat</h3>
                                        <p>संगणकावर WhatsApp Web वापरा</p>
                                    </div>
                                </a>
                            </div>
                            
                            <div class="pzp-qr-section">
                                <div class="pzp-qr-title">
                                    📷 QR कोड स्कॅन करा / Scan QR Code
                                </div>
                                <div class="pzp-qr-container">
                                    <img src="${qrCodeUrl}" 
                                         alt="Pune ZP WhatsApp QR Code" 
                                         class="pzp-qr-code"
                                         loading="lazy"
                                         onerror="this.style.display='none';">
                                </div>
                                <div class="pzp-qr-instructions">
                                    WhatsApp उघडा → Menu → QR स्कॅन करा<br>
                                    Open WhatsApp → Menu → Scan QR Code
                                </div>
                            </div>
                        </div>
                        
                        <div class="pzp-footer">
                            🕒 कार्यालयीन वेळ: सोम-शुक्र 10:00-18:00, शनि 10:00-14:00<br>
                            Working Hours: Mon-Fri 10AM-6PM, Sat 10AM-2PM
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', widgetHTML);
        }

        bindEvents() {
            const button = document.getElementById('pzp-button');
            const modal = document.getElementById('pzp-modal');
            const closeBtn = document.getElementById('pzp-close');
            
            // Button click
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleModal();
            });
            
            // Close button
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeModal();
            });
            
            // Click outside to close
            document.addEventListener('click', (e) => {
                if (!modal.contains(e.target) && !button.contains(e.target)) {
                    this.closeModal();
                }
            });
            
            // Escape key to close
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.isOpen) {
                    this.closeModal();
                }
            });
            
            // Track link clicks
            modal.querySelectorAll('.pzp-option').forEach(link => {
                link.addEventListener('click', (e) => {
                    const linkType = link.href.includes('web.whatsapp.com') ? 'web_chat' : 'mobile_chat';
                    Utils.track('chat_link_clicked', { 
                        label: linkType,
                        extra: Utils.getCurrentTimeIST()
                    });
                });
            });
            
            // Handle visibility change
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.isOpen) {
                    this.closeModal();
                }
            });
        }

        toggleModal() {
            if (this.isOpen) {
                this.closeModal();
            } else {
                this.openModal();
            }
        }

        openModal() {
            const modal = document.getElementById('pzp-modal');
            const button = document.getElementById('pzp-button');
            const badge = button.querySelector('.pzp-badge');
            
            modal.classList.add('active');
            this.isOpen = true;
            button.style.transform = 'scale(0.95)';
            
            // Hide notification badge
            if (badge) {
                badge.style.display = 'none';
            }
            
            Utils.track('modal_opened', { 
                label: 'user_interaction',
                extra: Utils.getCurrentTimeIST()
            });
        }

        closeModal() {
            const modal = document.getElementById('pzp-modal');
            const button = document.getElementById('pzp-button');
            
            modal.classList.remove('active');
            this.isOpen = false;
            button.style.transform = 'scale(1)';
            
            Utils.track('modal_closed', { 
                label: 'user_interaction',
                extra: Utils.getCurrentTimeIST()
            });
        }

        setupAutoShow() {
            if (!PUNE_ZP_CONFIG.autoShow) return;
            
            // Auto-show after 5 seconds for first-time visitors
            const hasSeenWidget = localStorage.getItem('pune_zp_widget_seen');
            
            if (!hasSeenWidget) {
                setTimeout(() => {
                    const button = document.getElementById('pzp-button');
                    if (button && !this.isOpen) {
                        button.style.animation = 'pulse 1.5s ease-in-out 3';
                        localStorage.setItem('pune_zp_widget_seen', 'true');
                        Utils.track('auto_show_triggered', { label: 'first_visit' });
                    }
                }, 5000);
            }
        }
    }

    // Initialize Widget
    function initPuneZPWidget() {
        // Check if DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                new PuneZPWhatsAppWidget();
            });
        } else {
            new PuneZPWhatsAppWidget();
        }
    }

    // Public API
    window.PuneZPWidget = {
        init: initPuneZPWidget,
        config: PUNE_ZP_CONFIG,
        version: '2.0.0'
    };

    // Auto-initialize
    initPuneZPWidget();

    console.log('🚀 Pune ZP AI WhatsApp Widget v2.0.0 initialized successfully!');
    console.log('📱 Ready for government website integration');
    console.log('🤖 AI Chatbot enabled for citizen services');

})();