/*
 * Copyright (c) 2014, Intel Corporation.
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms and conditions of the GNU Lesser General Public License,
 * version 2.1, as published by the Free Software Foundation.
 *
 * This program is distributed in the hope it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public License for
 * more details.
 *
 * Created by adua.
 */

/** @module EdisonMDNS */

var mdns = require('mdns2');
var os = require('os');

var ServiceRecord = require("./ServiceRecord.js");

/**
 * service cache of found service records. Used to eliminate duplicate advertisements.
 */
exports.serviceCache = {};

/**
 * All local services will be reported as running at this IP (even if interfaces might have different addresses).
 */
exports.LOCAL_ADDR = "127.0.0.1";

/**
 * addresses of all interfaces on this machine.
 */
exports.myaddresses = [];

/**
 * mdns service browser instance
 */
exports.browser = null;

/**
 * mdns service advertiser instance
 */
exports.advertiser = null;

/**
 * resolve service names to get address and other details.
 */
exports.mdnsResolverSequence = [
  mdns.rst.DNSServiceResolve(),
  mdns.rst.getaddrinfo({ families: [4] }),
  mdns.rst.makeAddressesUnique()
];

/**
 * singleton MDNS instance
 * @constructor
 */
function EdisonMDNS() {
  "use strict";
  setMyAddresses();
}

EdisonMDNS.prototype.name = "mdns";
EdisonMDNS.prototype.component = "discovery";

/**
 * Advertise the service on the LAN. Expects 'serviceSpec.address' to be a
 * resolved IPv4 address.
 * @param serviceSpec {object} - {@tutorial service-spec}
 */
EdisonMDNS.prototype.advertiseService = function (serviceSpec) {
  var serviceRecord = new ServiceRecord(serviceSpec);
  var options, address;
  if (serviceRecord.rawRecord.address) {
    if (serviceRecord.rawRecord.address === exports.LOCAL_ADDR) {
      address = mdns.loopbackInterface();
    } else {
      address = serviceRecord.rawRecord.address;
    }
    options = {txtRecord: serviceRecord.rawRecord.properties, name: serviceRecord.rawRecord.name,
      networkInterface: address};
  } else {
    options = {txtRecord: serviceRecord.rawRecord.properties, name: serviceRecord.rawRecord.name};
  }

  exports.advertiser = mdns.createAdvertisement(serviceRecord.rawRecord.type, serviceRecord.rawRecord.port, options);
  exports.advertiser.start();
};

/**
 * Find services on the LAN
 * @param serviceQuery {object} - {@tutorial service-query}
 * @param userServiceFilter {EdisonMDNS~userServiceFilter} - user-provided callback to choose the service(s) to connect to
 * @param callback {EdisonMDNS~returnServiceSpec} - return the service spec associated with the chosen service
 */
EdisonMDNS.prototype.discoverServices = function (serviceQuery, userServiceFilter, callback) {

  if (serviceQuery.constructor.name !== 'ServiceQuery') {
    throw new Error("Invalid argument: must use a ServiceQuery object to discover services.");
  }

  var rawServiceQuery = serviceQuery.rawQuery;

  // todo: needs fix: multiple subtypes in the serviceType causes errors.
  // make sure your serviceType contains only *one* subtype
  exports.browser = mdns.createBrowser(rawServiceQuery.type, { resolverSequence: exports.mdnsResolverSequence });

  exports.browser.on('serviceUp', function(service) {
    if (!serviceQueryFilter(serviceQuery, service)) {
      return;
    }

    var filteredServiceAddresses = serviceAddressFilter(service);

    if (filteredServiceAddresses.length != 0) {

      var serviceRecord = new ServiceRecord();
      serviceRecord.initFromRawServiceRecord(service);
      serviceRecord.setSuggestedAddresses(filteredServiceAddresses);
      serviceRecord.setSuggestedAddress(filteredServiceAddresses[0]);

      if (!userServiceFilter || userServiceFilter(serviceRecord)) {
        try {
          callback(serviceRecord.getSuggestedServiceSpec());
        } catch (err) {
          return;
        }
      }
    }
  });

  exports.browser.on('serviceDown', function(service) {
    "use strict";
    removeServiceFromCache(service);
  });

  exports.browser.on('serviceChanged', function(service) {
    "use strict";
    // todo: correctly handle service changed. Check if address has changed. Deleting is not the answer since service changed is raised even when serviceup happens.
    //removeServiceFromCache(service);
  });

  exports.browser.start();
};
/**
 * @callback EdisonMDNS~userServiceFilter
 * @param serviceRecord {object} A raw service record for the found service. Apps can inspect this record and
 * decide if they want to connect to this service or not ({@tutorial service-record}).
 */
/**
 * @callback EdisonMDNS~returnServiceSpec
 * @param serviceSpec {object} A condensed version of the raw service record for the found service. This is what's
 * passed to the plugins to create client or server objects ({@tutorial service-spec}).
 */

/**
 * Shutdown service browser if one is already running.
 */
EdisonMDNS.prototype.stopDiscovering = function () {
  if (exports.browser != null) {
    exports.browser.stop();
    exports.serviceCache = {};
    exports.browser = null;
  }
};

/**
 * Get and save all the IP addresses associated with this computer. This will be used to detect services that
 * are running locally and advertising via MDNS.
 */
function setMyAddresses() {
  var ifs = os.networkInterfaces();
  for (var i in ifs) {
    for (var j in ifs[i]) {
      var address = ifs[i][j];
      if (address.family === 'IPv4' && !address.internal) {
        exports.myaddresses.push(address.address);
      }
    }
  }
}

/**
 * Delete a service from the cache. This happens when a service stops advertising itself.
 * @param service {object} The service record associated with the respective service.
 */
function removeServiceFromCache(service) {
  "use strict";
  if (!service.name) {
    console.log("WARN: Cannot remove service. No name in service record. " +
      "The service originally intended to be removed will remain in cache.");
    return;
  }
  delete exports.serviceCache[service.name];
}

/**
 * Check if a service is running locally.
 * @param serviceAddresses {Array} list of IP addresses
 * @returns {boolean} true if local, false otherwise
 */
function serviceIsLocal(serviceAddresses) {
  "use strict";

  if (!serviceAddresses || serviceAddresses.length == 0) {
    return false;
  }

  return serviceAddresses.some(function (serviceAddress) {
    var isLocal = exports.myaddresses.some(function (myaddress) {
      if (serviceAddress === myaddress) {
        return true;
      }
      return false;
    });

    if (isLocal) {
      return true;
    }

    return false;

  });
}

/**
 * Length of matching address prefix. A found service address is compared with a local interface address.
 * @param serviceAddress {string} IP address of service
 * @param myaddress {string} IP address of one of the interfaces on this machine
 * @returns {number} length of the matching prefix
 */
function getMatchingPrefixLen(serviceAddress, myaddress) {
  "use strict";
  var i = 0;
  while(i < serviceAddress.length && i < myaddress.length && serviceAddress[i] == myaddress[i]) {
    i++;
  }

  return i;
}

/**
 * Sort all the addresses found in the service record by the length of the longest prefix match with a local address.
 * Used to suggest to the application the best addresses to use when connecting with the service.
 * @param serviceAddresses {Array} list of addresses found in the mDNS servcice record ({@tutorial service-record})
 * @returns {Array} sorted service addresses
 */
function getAddressesWithLongestPrefixMatch(serviceAddresses) {
  "use strict";
  var resultStore = {};

  serviceAddresses.forEach(function (serviceAddress) {
    exports.myaddresses.forEach(function (myaddress) {
      var matchingPrefixLen = getMatchingPrefixLen(serviceAddress, myaddress);
      if (typeof resultStore[matchingPrefixLen] === 'undefined') {
        resultStore[matchingPrefixLen] = {};
      }
      if (typeof resultStore[matchingPrefixLen] === 'undefined') {
        resultStore[matchingPrefixLen] = {};
      }
      resultStore[matchingPrefixLen][serviceAddress] = true;
    });
  });

  var allPrefixLengths = Object.keys(resultStore);
  if (allPrefixLengths.length == 0) {
    return [];
  }
  allPrefixLengths = allPrefixLengths.map(Math.round);
  allPrefixLengths.sort(function(n1,n2){return n1 - n2});
  return Object.keys(resultStore[allPrefixLengths[allPrefixLengths.length-1]]);
}

/**
 * Eliminate duplicate advertisements, sort service addresses by longest prefix match to local addresses, or
 * return local address for services running on this computer
 * @param service {object} service record
 * @returns {Array} sorted service addresses or an array that contains the local address
 * ({@link EdisonMDNS.exports.LOCAL_ADDR})
 */
function serviceAddressFilter(service) {
  "use strict";

  if (!service.addresses || !service.name) {
    if (!service.name) {
      console.log("WARN: Discovered a service without a name. Dropping.");
    } else {
      console.log("WARN: Discovered a service without addresses. Dropping.");
    }
    return [];
  }

  var notSeenBefore = [];
  service.addresses.forEach(function (address) {
    "use strict";
    if (typeof exports.serviceCache[service.name] === 'undefined') {
      exports.serviceCache[service.name] = {};
    }
    if (!exports.serviceCache[service.name][address]) {
      exports.serviceCache[service.name][address] = true;
      notSeenBefore.push(address);
    }
  });

  if (notSeenBefore.length == 0) {
    return [];
  }

  if (serviceIsLocal(Object.keys(exports.serviceCache[service.name]))) {
    return [ exports.LOCAL_ADDR ];
  }

  if (notSeenBefore.length == 1) {
    return [ notSeenBefore[0] ];
  }

  var longestPrefixMatches = getAddressesWithLongestPrefixMatch(notSeenBefore);
  longestPrefixMatches.sort(); // so we can return addresses in the same order for the same service. Necessary?

  return longestPrefixMatches;
}

/**
 * Check if a found service record matches the application's query.
 * @param query {object} A query for the kind of service records the app is looking for ({@tutorial service-query})
 * @param serviceRecord {object} A service record returned by mDNS ({@tutorial service-record})
 * @returns {boolean} true if service record matches query, false otherwise
 */
function serviceQueryFilter(query, serviceRecord) {
  "use strict";

  if (query.nameRegEx) {
    if (serviceRecord.name) {
      if (query.nameRegEx.test(serviceRecord.name)) {
        return true;
      }
    }
  }

  if (query.rawQuery.port) {
    if (serviceRecord.port) {
      if (query.rawQuery.port == serviceRecord.port) {
        return true;
      }
    }
  }

  if (query.rawQuery.properties) {
    // OR
    if (serviceRecord.properties) {
      var found = Object.keys(query.rawQuery.properties).some(function (property) {
        if (serviceRecord.properties[property]) {
          if (serviceRecord.properties[property] === query.rawQuery.properties[property]) {
            return true;
          }
        }
      });
      if (found) {
        return true;
      }
    }
  }

  // MUST contain all fields tested above
  if (!query.nameRegEx && !query.rawQuery.port && !query.properties) {
    // only a service.type query was issued. Since serrvice.type is a compulsory
    // query attribute to search for services, this service must be of the
    // same type.
    return true;
  }

  return false;
}

module.exports = new EdisonMDNS(); // must be at the end