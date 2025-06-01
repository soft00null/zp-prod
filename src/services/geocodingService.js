const axios = require('axios');
const logger = require('../utils/logger');
const { db, admin } = require('../config/firebase');

// Google Maps API Key
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Pune Zilla Panchayat boundaries (approximate)
const PUNE_ZP_BOUNDS = {
  northeast: { lat: 19.5, lng: 75.0 },
  southwest: { lat: 18.0, lng: 73.5 }
};

// Collection for geocoding cache
const geocodingCollection = db.collection('geocoding');

// Geocode village name with validation for Pune ZP
const geocodeVillage = async (villageName, language = 'en') => {
  try {
    logger.info(`Geocoding village: ${villageName}`);

    // Check cache first
    const cachedResult = await getCachedGeocode(villageName);
    if (cachedResult) {
      logger.info(`Using cached geocode for ${villageName}`);
      return cachedResult;
    }

    // Prepare search query with Pune context
    const searchQueries = [
      `${villageName}, Pune District, Maharashtra, India`,
      `${villageName}, Pune, Maharashtra, India`,
      `${villageName} village, Pune District, Maharashtra`,
      `${villageName}, Maharashtra, India`
    ];

    let bestResult = null;
    let highestScore = 0;

    for (const query of searchQueries) {
      try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: {
            address: query,
            key: GOOGLE_MAPS_API_KEY,
            region: 'IN',
            language: language === 'mr' ? 'hi' : 'en'
          }
        });

        if (response.data.status === 'OK' && response.data.results.length > 0) {
          const result = response.data.results[0];
          
          // Calculate relevance score
          const score = calculateRelevanceScore(result, villageName);
          
          if (score > highestScore) {
            highestScore = score;
            bestResult = result;
          }
        }
      } catch (error) {
        logger.warn(`Geocoding query failed for: ${query}`, error.message);
        continue;
      }
    }

    if (!bestResult) {
      return {
        success: false,
        error: 'Village not found',
        message: language === 'mr' 
          ? 'हे गाव सापडले नाही. कृपया योग्य गाव नाव लिहा.'
          : 'Village not found. Please provide a valid village name.'
      };
    }

    // Validate if location is within Pune ZP bounds
    const location = bestResult.geometry.location;
    const isInPuneZP = isLocationInPuneZP(location);

    if (!isInPuneZP) {
      return {
        success: false,
        error: 'Village not in Pune ZP',
        location: location,
        address: bestResult.formatted_address,
        message: language === 'mr'
          ? 'हे गाव पुणे जिल्हा परिषदेच्या हद्दीत नाही. कृपया पुणे जिल्ह्यातील गाव नाव द्या.'
          : 'This village is not within Pune Zilla Panchayat boundaries. Please provide a village name from Pune district.'
      };
    }

    // Extract administrative details
    const adminDetails = extractAdministrativeDetails(bestResult);

    const geocodeResult = {
      success: true,
      villageName: villageName,
      coordinates: {
        latitude: location.lat,
        longitude: location.lng
      },
      formattedAddress: bestResult.formatted_address,
      placeId: bestResult.place_id,
      administrative: adminDetails,
      bounds: bestResult.geometry.bounds || null,
      locationType: bestResult.geometry.location_type,
      confidence: highestScore,
      geocodedAt: new Date().toISOString()
    };

    // Cache the result
    await cacheGeocode(villageName, geocodeResult);

    logger.info(`Successfully geocoded ${villageName}: ${location.lat}, ${location.lng}`);
    return geocodeResult;

  } catch (error) {
    logger.error(`Error geocoding village ${villageName}:`, error);
    return {
      success: false,
      error: 'Geocoding service error',
      message: language === 'mr'
        ? 'गाव शोधण्यात तांत्रिक समस्या आली. कृपया पुन्हा प्रयत्न करा.'
        : 'Technical issue while searching village. Please try again.'
    };
  }
};

// Check if location is within Pune ZP boundaries
const isLocationInPuneZP = (location) => {
  const lat = location.lat;
  const lng = location.lng;

  return (
    lat >= PUNE_ZP_BOUNDS.southwest.lat &&
    lat <= PUNE_ZP_BOUNDS.northeast.lat &&
    lng >= PUNE_ZP_BOUNDS.southwest.lng &&
    lng <= PUNE_ZP_BOUNDS.northeast.lng
  );
};

// Calculate relevance score for geocoding results
const calculateRelevanceScore = (result, searchTerm) => {
  let score = 0;
  const searchLower = searchTerm.toLowerCase();
  const addressLower = result.formatted_address.toLowerCase();

  // Exact match in address components
  const addressComponents = result.address_components || [];
  
  for (const component of addressComponents) {
    const longName = component.long_name.toLowerCase();
    const shortName = component.short_name.toLowerCase();
    
    if (longName === searchLower || shortName === searchLower) {
      score += 100;
    } else if (longName.includes(searchLower) || shortName.includes(searchLower)) {
      score += 50;
    }
    
    // Bonus for administrative levels
    if (component.types.includes('administrative_area_level_2') && longName.includes('pune')) {
      score += 30;
    }
    if (component.types.includes('administrative_area_level_1') && longName.includes('maharashtra')) {
      score += 20;
    }
  }

  // Partial match in formatted address
  if (addressLower.includes(searchLower)) {
    score += 25;
  }

  // Location type bonus
  switch (result.geometry.location_type) {
    case 'ROOFTOP':
      score += 20;
      break;
    case 'RANGE_INTERPOLATED':
      score += 15;
      break;
    case 'GEOMETRIC_CENTER':
      score += 10;
      break;
    case 'APPROXIMATE':
      score += 5;
      break;
  }

  return score;
};

// Extract administrative details from geocoding result
const extractAdministrativeDetails = (result) => {
  const components = result.address_components || [];
  const details = {
    village: null,
    taluka: null,
    district: null,
    state: null,
    country: null,
    pincode: null
  };

  for (const component of components) {
    const types = component.types;
    
    if (types.includes('locality') || types.includes('sublocality')) {
      details.village = component.long_name;
    } else if (types.includes('administrative_area_level_3')) {
      details.taluka = component.long_name;
    } else if (types.includes('administrative_area_level_2')) {
      details.district = component.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      details.state = component.long_name;
    } else if (types.includes('country')) {
      details.country = component.long_name;
    } else if (types.includes('postal_code')) {
      details.pincode = component.long_name;
    }
  }

  return details;
};

// Cache geocoding results
const cacheGeocode = async (villageName, result) => {
  try {
    const cacheKey = villageName.toLowerCase().trim();
    
    await geocodingCollection.doc(cacheKey).set({
      villageName: villageName,
      result: result,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.FieldValue.serverTimestamp() // Will set proper expiry in production
    });

    logger.info(`Cached geocode result for ${villageName}`);
  } catch (error) {
    logger.error(`Error caching geocode for ${villageName}:`, error);
  }
};

// Get cached geocoding result
const getCachedGeocode = async (villageName) => {
  try {
    const cacheKey = villageName.toLowerCase().trim();
    const doc = await geocodingCollection.doc(cacheKey).get();
    
    if (doc.exists) {
      const data = doc.data();
      // Check if cache is still valid (24 hours)
      const cachedAt = data.cachedAt?.toDate();
      const now = new Date();
      const hoursDiff = (now - cachedAt) / (1000 * 60 * 60);
      
      if (hoursDiff < 24) {
        return data.result;
      } else {
        // Cache expired, delete it
        await doc.ref.delete();
      }
    }
    
    return null;
  } catch (error) {
    logger.error(`Error getting cached geocode for ${villageName}:`, error);
    return null;
  }
};

// Get list of Pune ZP villages (for validation/suggestions)
const getPuneZPVillages = async () => {
  try {
    // This could be populated from a comprehensive list
    const villagesSnapshot = await geocodingCollection
      .where('result.administrative.district', '==', 'Pune')
      .limit(100)
      .get();

    const villages = [];
    villagesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.result && data.result.success) {
        villages.push({
          name: data.villageName,
          taluka: data.result.administrative.taluka,
          coordinates: data.result.coordinates
        });
      }
    });

    return villages;
  } catch (error) {
    logger.error('Error getting Pune ZP villages:', error);
    return [];
  }
};

// Reverse geocoding to get village name from coordinates
const reverseGeocode = async (latitude, longitude) => {
  try {
    const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: {
        latlng: `${latitude},${longitude}`,
        key: GOOGLE_MAPS_API_KEY,
        result_type: 'locality|sublocality|administrative_area_level_3'
      }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const adminDetails = extractAdministrativeDetails(result);
      
      return {
        success: true,
        address: result.formatted_address,
        administrative: adminDetails,
        isInPuneZP: isLocationInPuneZP({ lat: latitude, lng: longitude })
      };
    }

    return {
      success: false,
      error: 'No results found for coordinates'
    };

  } catch (error) {
    logger.error('Error in reverse geocoding:', error);
    return {
      success: false,
      error: 'Reverse geocoding failed'
    };
  }
};

module.exports = {
  geocodeVillage,
  reverseGeocode,
  getPuneZPVillages,
  isLocationInPuneZP
};