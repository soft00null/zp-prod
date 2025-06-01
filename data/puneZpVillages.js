// List of villages in Pune Zilla Panchayat organized by taluka
const PUNE_ZP_VILLAGES = {
  "Haveli": [
    "Alephata", "Ambegaon", "Anandnagar", "Aundh", "Bavdhan", "Bawadi", "Bhor", 
    "Bhugaon", "Dehu", "Ghotawade", "Hadapsar", "Khadaki", "Kirkatwadi", 
    "Kondhane", "Lohegaon", "Mahalunge", "Manjari", "Markal", "Nigdi", 
    "Pashan", "Pirangut", "Pune", "Sus", "Talegaon", "Thergaon", "Vadgaon"
  ],
  "Maval": [
    "Alegaon", "Amboli", "Bhaje", "Bor", "Chakan", "Dehu Road", "Dudhiware", 
    "Jambhulwadi", "Kanhe", "Karla", "Khandala", "Kune", "Kurvande", 
    "Lonavala", "Malawli", "Malavli", "Nane", "Pavana", "Rajgurunagar", 
    "Shirgaon", "Talegaon Dabhade", "Tungarli", "Vadgaon Maval", "Valvan", "Walhe"
  ],
  "Mulshi": [
    "Aakurdi", "Andgaon", "Bhare", "Bhugaon", "Donaje", "Ghotawade", 
    "Gujar Nimbalkar", "Hinjawadi", "Katraj", "Kesnand", "Lavasa", 
    "Manjari Khurd", "Mulshi", "Paud", "Pirangut", "Somatane", "Tamhini", 
    "Telgaon", "Urse", "Vagholi", "Wakad"
  ],
  "Baramati": [
    "Akolner", "Baramati", "Bhigwan", "Bijawadi", "Deur", "Gunjanur", 
    "Jalgaon", "Kanheri", "Karegaon", "Kumthe", "Malegaon", "Malshiras", 
    "Morgaon", "Nira", "Pargaon", "Pimpri", "Shedshal", "Shirsufal", 
    "Shrigonda", "Supa", "Tandulwadi", "Tembhurni", "Wadu", "Yavat"
  ],
  "Purandar": [
    "Arvi", "Bhavaninagar", "Bhilarewadi", "Jejuri", "Kalambhe", "Koregaon", 
    "Kudje", "Mandangad", "Narayangaon", "Nazare", "Nhavare", "Pargaon", 
    "Parner", "Purandar", "Rajuri", "Saswad", "Shirgaon", "Supe", 
    "Takali", "Undavadi", "Vadhu", "Velhe", "Wadaj"
  ],
  "Daund": [
    "Alegaon", "Apti", "Bhigwan", "Daund", "Dhamari", "Dhavaleshwar", 
    "Gavhane", "Gulunche", "Jeur", "Kashti", "Kedgaon", "Khadakwasla", 
    "Khed", "Malegaon", "Nanvij", "Nimgaon", "Ranjangaon", "Rui", 
    "Sanaswadi", "Shikrapur", "Supa", "Waki"
  ],
  "Indapur": [
    "Akolner", "Baramati", "Bhigwan", "Dhoki", "Indapur", "Jinti", 
    "Kasurdi", "Khandobachi", "Kurundwad", "Majalgaon", "Naigaon", 
    "Nimgaon", "Ozar", "Pargaon", "Ranjangaon", "Shelgaon", "Tulapur", 
    "Ugar", "Wagholi", "Walchandnagar", "Yavat"
  ],
  "Junnar": [
    "Ale", "Alephata", "Ambegaon", "Bhimashankar", "Ghodegaon", "Junnar", 
    "Kalyan", "Kanheri", "Kukadi", "Lenyadri", "Manchar", "Narayangaon", 
    "Nimgiri", "Otur", "Ozar", "Pabal", "Rajur", "Shirur", "Vadgaon"
  ],
  "Ambegaon": [
    "Ambegaon", "Bhimashankar", "Dhamari", "Ghodegaon", "Jambhulne", 
    "Kalmodi", "Kashti", "Khed", "Manchar", "Pargaon", "Rajgurunagar", 
    "Sangvi", "Shirur", "Talegaon"
  ],
  "Khed": [
    "Alephata", "Chakan", "Jambhulne", "Kalmodi", "Kashti", "Khed", 
    "Kudje", "Nane", "Pargaon", "Rajgurunagar", "Sangvi", "Shikrapur", 
    "Shirur", "Talegaon"
  ],
  "Shirur": [
    "Ghodnadi", "Hinjawadi", "Kalas", "Kendur", "Koregaon Bhima", 
    "Manjari", "Nimgaon", "Pabal", "Pargaon", "Ranjangaon", "Shirur", 
    "Shrirampur", "Talegaon", "Vadgaon", "Velu"
  ],
  "Bhor": [
    "Bhor", "Diveghat", "Jambhrun", "Kankeshwar", "Khandala", "Maregaon", 
    "Morgaon", "Nasarapur", "Shindawane", "Targaon", "Varsoli", "Walchandnagar"
  ],
  "Velhe": [
    "Bhor", "Diveghat", "Kankeshwar", "Kashti", "Kudje", "Morgaon", 
    "Mulshi", "Pargaon", "Rajuri", "Shindawane", "Velhe"
  ]
};

// Taluka-wise coordinates (approximate centers)
const TALUKA_COORDINATES = {
  "Haveli": { lat: 18.5679, lng: 73.9143 },
  "Maval": { lat: 18.7645, lng: 73.4084 },
  "Mulshi": { lat: 18.5333, lng: 73.5167 },
  "Baramati": { lat: 18.1514, lng: 74.5815 },
  "Purandar": { lat: 18.2833, lng: 74.0833 },
  "Daund": { lat: 18.4648, lng: 74.5815 },
  "Indapur": { lat: 18.1167, lng: 75.0167 },
  "Junnar": { lat: 19.2167, lng: 73.8833 },
  "Ambegaon": { lat: 19.0167, lng: 73.7833 },
  "Khed": { lat: 18.9500, lng: 73.3833 },
  "Shirur": { lat: 18.8333, lng: 74.3833 },
  "Bhor": { lat: 18.1500, lng: 73.8500 },
  "Velhe": { lat: 18.1167, lng: 73.4833 }
};

// Get all villages as a flat array
const getAllVillages = () => {
  const allVillages = [];
  Object.keys(PUNE_ZP_VILLAGES).forEach(taluka => {
    PUNE_ZP_VILLAGES[taluka].forEach(village => {
      allVillages.push({
        village: village,
        taluka: taluka,
        coordinates: TALUKA_COORDINATES[taluka]
      });
    });
  });
  return allVillages;
};

// Search villages by name (fuzzy matching)
const searchVillages = (searchTerm) => {
  const searchLower = searchTerm.toLowerCase();
  const results = [];
  
  Object.keys(PUNE_ZP_VILLAGES).forEach(taluka => {
    PUNE_ZP_VILLAGES[taluka].forEach(village => {
      const villageLower = village.toLowerCase();
      
      // Exact match
      if (villageLower === searchLower) {
        results.push({
          village: village,
          taluka: taluka,
          coordinates: TALUKA_COORDINATES[taluka],
          matchType: 'exact',
          score: 100
        });
      }
      // Starts with search term
      else if (villageLower.startsWith(searchLower)) {
        results.push({
          village: village,
          taluka: taluka,
          coordinates: TALUKA_COORDINATES[taluka],
          matchType: 'starts_with',
          score: 80
        });
      }
      // Contains search term
      else if (villageLower.includes(searchLower)) {
        results.push({
          village: village,
          taluka: taluka,
          coordinates: TALUKA_COORDINATES[taluka],
          matchType: 'contains',
          score: 60
        });
      }
    });
  });
  
  // Sort by score (best matches first)
  return results.sort((a, b) => b.score - a.score);
};

// Get villages by taluka
const getVillagesByTaluka = (taluka) => {
  return PUNE_ZP_VILLAGES[taluka] || [];
};

// Validate if village exists in Pune ZP
const isValidPuneZPVillage = (villageName) => {
  const searchResults = searchVillages(villageName);
  return searchResults.some(result => result.matchType === 'exact');
};

module.exports = {
  PUNE_ZP_VILLAGES,
  TALUKA_COORDINATES,
  getAllVillages,
  searchVillages,
  getVillagesByTaluka,
  isValidPuneZPVillage
};