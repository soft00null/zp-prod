const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');

// Collection references
const citizensCollection = db.collection('citizens');

// UPDATED: Simplified registration states - only Name and Village
const REGISTRATION_STATES = {
  INITIAL: {
    id: 'initial',
    name: 'Initial Contact',
    nextStates: ['awaiting_name'],
    requiredData: []
  },
  AWAITING_NAME: {
    id: 'awaiting_name',
    name: 'Awaiting Name',
    nextStates: ['awaiting_village'],
    requiredData: ['userProvidedName']
  },
  AWAITING_VILLAGE: {
    id: 'awaiting_village',
    name: 'Awaiting Village',
    nextStates: ['completed'],
    requiredData: ['village', 'coordinates']
  },
  COMPLETED: {
    id: 'completed',
    name: 'Registration Complete',
    nextStates: [],
    requiredData: []
  }
};

// Create state record
const createStateRecord = async (whatsappNumber, stateId, context = {}) => {
  try {
    const stateData = {
      stateId,
      stateName: REGISTRATION_STATES[stateId.toUpperCase()]?.name || stateId,
      context,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
      attempts: 0,
      lastAttemptAt: null,
      completedAt: null,
      functionCallResults: [],
      metadata: {
        userAgent: context.userAgent || null,
        sessionId: context.sessionId || null,
        language: context.language || null
      }
    };

    const stateRef = await citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .add(stateData);

    logger.info(`Created state record: ${stateId} for ${whatsappNumber}`);
    return {
      id: stateRef.id,
      ...stateData,
      createdAt: Date.now()
    };
  } catch (error) {
    logger.error(`Error creating state record for ${whatsappNumber}:`, error);
    throw error;
  }
};

// Get current state
const getCurrentState = async (whatsappNumber) => {
  try {
    const statesSnapshot = await citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .where('isActive', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (statesSnapshot.empty) {
      return null;
    }

    const stateDoc = statesSnapshot.docs[0];
    return {
      id: stateDoc.id,
      ...stateDoc.data()
    };
  } catch (error) {
    logger.error(`Error getting current state for ${whatsappNumber}:`, error);
    return null;
  }
};

// Update state with function call results
const updateStateWithFunctionResults = async (whatsappNumber, currentState, functionResults) => {
  try {
    const currentTimestamp = new Date();

    const stateDoc = await citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .doc(currentState.id)
      .get();

    const currentData = stateDoc.data() || {};
    const existingResults = currentData.functionCallResults || [];

    const newFunctionCallResult = {
      timestamp: currentTimestamp,
      results: functionResults,
      confidence: functionResults.confidence || 0.0,
      method: 'function_calling',
      executedAt: currentTimestamp.toISOString()
    };

    const updatedResults = [...existingResults, newFunctionCallResult];

    const updateData = {
      attempts: admin.firestore.FieldValue.increment(1),
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      functionCallResults: updatedResults,
      lastFunctionCallResult: newFunctionCallResult
    };

    await citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .doc(currentState.id)
      .update(updateData);

    logger.info(`Updated state ${currentState.stateId} with function results for ${whatsappNumber}`);
    return true;
  } catch (error) {
    logger.error(`Error updating state with function results for ${whatsappNumber}:`, error);
    return false;
  }
};

// Store function call results in subcollection
const storeFunctionCallResultInSubcollection = async (whatsappNumber, stateId, functionResults) => {
  try {
    const functionCallData = {
      stateId,
      results: functionResults,
      confidence: functionResults.confidence || 0.0,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      executedAt: new Date().toISOString(),
      method: 'function_calling'
    };

    await citizensCollection
      .doc(whatsappNumber)
      .collection('functionCalls')
      .add(functionCallData);

    logger.info(`Stored function call result in subcollection for ${whatsappNumber}`);
    return true;
  } catch (error) {
    logger.error(`Error storing function call result in subcollection for ${whatsappNumber}:`, error);
    return false;
  }
};

// Complete state transition
const completeStateTransition = async (whatsappNumber, currentState, extractedData, nextStateId) => {
  try {
    const batch = db.batch();
    const currentTimestamp = new Date();

    const currentStateRef = citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .doc(currentState.id);

    batch.update(currentStateRef, {
      isActive: false,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      extractedData,
      isCompleted: true,
      finalConfidence: extractedData.confidence || null,
      completionTimestamp: currentTimestamp.toISOString()
    });

    if (nextStateId) {
      const nextStateData = {
        stateId: nextStateId,
        stateName: REGISTRATION_STATES[nextStateId.toUpperCase()]?.name || nextStateId,
        context: {
          ...currentState.context,
          previousState: currentState.stateId,
          extractedData
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        attempts: 0,
        lastAttemptAt: null,
        completedAt: null,
        functionCallResults: [],
        metadata: {
          ...currentState.metadata,
          transitionedFrom: currentState.stateId,
          transitionTimestamp: currentTimestamp.toISOString()
        }
      };

      const nextStateRef = citizensCollection
        .doc(whatsappNumber)
        .collection('states')
        .doc();

      batch.set(nextStateRef, nextStateData);
    }

    await batch.commit();

    logger.info(`Completed state transition: ${currentState.stateId} → ${nextStateId} for ${whatsappNumber}`);
    return true;
  } catch (error) {
    logger.error(`Error completing state transition for ${whatsappNumber}:`, error);
    return false;
  }
};

// Get state history
const getStateHistory = async (whatsappNumber, limit = 10) => {
  try {
    const statesSnapshot = await citizensCollection
      .doc(whatsappNumber)
      .collection('states')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const states = [];
    statesSnapshot.forEach(doc => {
      const data = doc.data();
      states.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        completedAt: data.completedAt?.toDate?.() || data.completedAt,
        lastAttemptAt: data.lastAttemptAt?.toDate?.() || data.lastAttemptAt
      });
    });

    return states;
  } catch (error) {
    logger.error(`Error getting state history for ${whatsappNumber}:`, error);
    return [];
  }
};

module.exports = {
  REGISTRATION_STATES,
  createStateRecord,
  getCurrentState,
  updateStateWithFunctionResults,
  storeFunctionCallResultInSubcollection,
  completeStateTransition,
  getStateHistory
};