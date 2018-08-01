require('dotenv').config();
var express = require('express');
var _ = require('lodash');
var app = express();
var request = require('request-promise-native');
var morgan = require('morgan');
var S = require('string');


const CONFIG = {
  atlas_username: process.env.ATLAS_USERNAME,
  atlas_api_key: process.env.ATLAS_API_KEY,
  port: process.env.PORT || 3333
}

const PROCESS_MEASUREMENT_VALUES = [
  'ASSERT_REGULAR',
  'ASSERT_WARNING',
  'ASSERT_MSG',
  'ASSERT_USER',
  'CACHE_BYTES_READ_INTO',
  'CACHE_BYTES_WRITTEN_FROM',
  'CACHE_USAGE_DIRTY',
  'CACHE_USAGE_USED',
  'CONNECTIONS',
  'CURSORS_TOTAL_OPEN',
  'CURSORS_TOTAL_TIMED_OUT',
  'DB_STORAGE_TOTAL',
  'DB_DATA_SIZE_TOTAL',
  'DOCUMENT_METRICS_RETURNED',
  'DOCUMENT_METRICS_INSERTED',
  'DOCUMENT_METRICS_UPDATED',
  'DOCUMENT_METRICS_DELETED',
  'EXTRA_INFO_PAGE_FAULTS',
  'GLOBAL_LOCK_CURRENT_QUEUE_TOTAL',
  'GLOBAL_LOCK_CURRENT_QUEUE_READERS',
  'GLOBAL_LOCK_CURRENT_QUEUE_WRITERS',
  'MEMORY_RESIDENT',
  'MEMORY_VIRTUAL',
  'MEMORY_MAPPED',
  'NETWORK_BYTES_IN',
  'NETWORK_BYTES_OUT',
  'NETWORK_NUM_REQUESTS',
  'OPCOUNTER_CMD',
  'OPCOUNTER_QUERY',
  'OPCOUNTER_UPDATE',
  'OPCOUNTER_DELETE',
  'OPCOUNTER_GETMORE',
  'OPCOUNTER_INSERT',
  'OPCOUNTER_REPL_CMD',
  'OPCOUNTER_REPL_UPDATE',
  'OPCOUNTER_REPL_DELETE',
  'OPCOUNTER_REPL_INSERT',
  'OPERATIONS_SCAN_AND_ORDER',
  'OP_EXECUTION_TIME_READS',
  'OP_EXECUTION_TIME_WRITES',
  'OP_EXECUTION_TIME_COMMANDS',
  'OPLOG_MASTER_TIME',
  'OPLOG_RATE_GB_PER_HOUR',
  'QUERY_EXECUTOR_SCANNED',
  'QUERY_EXECUTOR_SCANNED_OBJECTS',
  'QUERY_TARGETING_SCANNED_PER_RETURNED',
  'QUERY_TARGETING_SCANNED_OBJECTS_PER_RETURNED',
  'TICKETS_AVAILABLE_READS',
  'TICKETS_AVAILABLE_WRITES',
  'PROCESS_CPU_USER',
  'PROCESS_CPU_KERNEL',
  'PROCESS_CPU_CHILDREN_USER',
  'PROCESS_CPU_CHILDREN_KERNEL',
  'PROCESS_NORMALIZED_CPU_USER',
  'PROCESS_NORMALIZED_CPU_KERNEL',
  'PROCESS_NORMALIZED_CPU_CHILDREN_USER',
  'PROCESS_NORMALIZED_CPU_CHILDREN_KERNEL',
  'SYSTEM_CPU_USER',
  'SYSTEM_CPU_KERNEL',
  'SYSTEM_CPU_NICE',
  'SYSTEM_CPU_IOWAIT',
  'SYSTEM_CPU_IRQ',
  'SYSTEM_CPU_SOFTIRQ',
  'SYSTEM_CPU_GUEST',
  'SYSTEM_CPU_STEAL',
  'SYSTEM_NORMALIZED_CPU_USER',
  'SYSTEM_NORMALIZED_CPU_KERNEL',
  'SYSTEM_NORMALIZED_CPU_NICE',
  'SYSTEM_NORMALIZED_CPU_IOWAIT',
  'SYSTEM_NORMALIZED_CPU_IRQ',
  'SYSTEM_NORMALIZED_CPU_SOFTIRQ',
  'SYSTEM_NORMALIZED_CPU_GUEST',
  'SYSTEM_NORMALIZED_CPU_STEAL'
];
var PROCESS_MEASUREMENTS = {};
_.each(PROCESS_MEASUREMENT_VALUES, function(m) {
  PROCESS_MEASUREMENTS[m] = S(m).humanize().s;
})

const DISK_MEASUREMENT_VALUES = [
  'DISK_PARTITION_IOPS_READ',
  'DISK_PARTITION_IOPS_WRITE',
  'DISK_PARTITION_IOPS_TOTAL',
  'DISK_PARTITION_UTILIZATION',
  'DISK_PARTITION_LATENCY_READ',
  'DISK_PARTITION_LATENCY_WRITE',
  'DISK_PARTITION_SPACE_FREE',
  'DISK_PARTITION_SPACE_USED',
  'DISK_PARTITION_SPACE_PERCENT_FREE',
  'DISK_PARTITION_SPACE_PERCENT_USED'
];

var DISK_MEASUREMENTS = {};
_.each(DISK_MEASUREMENT_VALUES, function(m) {
  DISK_MEASUREMENTS[m] = S(m).humanize().s;
})


function setHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "accept, content-type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function requestFromAtlas(path, options) {
  if (options) {
    // we have to do this madness because multiple measurements get specified with the same query string key
    const queryString = _.map(options, function(optPair) {
      return optPair.join('=');
    }).join('&');
    path += '?'+queryString;
  }
  const url = 'https://cloud.mongodb.com/api/atlas/v1.0'+path;

  console.log("  => Making GET request to", url);
  return request.get(url, {
    json: true,
    resolveWithFullResponse: true,
    auth: {
      user: CONFIG.atlas_username,
      pass: CONFIG.atlas_api_key,
      sendImmediately: false
    }
  });
}

function getMongoHosts(req) {
  return new Promise(function(resolve, reject) {
    var useCache = false;
    var responseFromCache = false;

    if (useCache) {
      // TODO: figure out caching
      responseFromCache = true;
      // resolve(mongos);
    }

    if (!responseFromCache) {
      requestFromAtlas(`/groups/${req.auth.projectId}/clusters/${req.auth.clusterName}`).then(function(response) {
        const mongos = mongosFromURI(response.body.mongoURI)
        resolve(mongos);
      }).catch(function(error) {
        reject(error.error || error);
      });
    }
  });
}

function getDiskNames(req, mongo) {
  return new Promise(function(resolve, reject) {
    var useCache = false;
    var responseFromCache = false;

    if (useCache) {
      // TODO: figure out caching
      responseFromCache = true;
      // resolve(mongos);
    }

    if (!responseFromCache) {
      requestFromAtlas(`/groups/${req.auth.projectId}/processes/${mongo}/disks`).then(function(response) {
        resolve({
          name: mongo,
          disks: response.body.results.map((r) => r.partitionName)
        });
      }).catch(function(error) {
        reject(error.error || error);
      });
    }
  });
}

function mongosFromURI(mongoURI) {
  if (_.isEmpty(mongoURI)) {
    return [];
  }

  return mongoURI.replace('mongodb://', '').split(',');
}

function authorizationParser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!_.isEmpty(authHeader)) {
    const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    req.auth = {clusterName: auth[0], projectId: auth[1]};
  } else {
    req.auth = {};
  }
  next();
}

function timestampToEpoch(timestamp) {
  return Date.parse(timestamp) / 1;
}







//****************************         MIDDLEWARE
app.use(morgan('combined'));
app.use(express.json());
app.use(authorizationParser);











// this route is used when saving a datasource to test if it can authorize
app.all('/', function(req, res) {
  setHeaders(res);

  getMongoHosts(req).then(function(mongos) {
    res.status(200).json(mongos).end();
  }).catch(function(error) {
    res.status(401).json(error).end();
  });
});


// this route is used when setting up a panel to return possible measurements
app.all('/search', function(req, res){
  setHeaders(res);

  let result = [];

  const searchValue = req.body.target;
  if (_.isEmpty(searchValue)) {
    _.map(PROCESS_MEASUREMENTS, function(k, v) {
      result.push({text: k, value: v});
    });
    _.map(DISK_MEASUREMENTS, function(k, v) {
      result.push({text: k, value: v});
    });
  } else {
    // TODO
  }

  res.json(result);
  res.end();
});




function getDisks(diskTargets, req, mongos) {
  if (_.isEmpty(diskTargets)) {
    return Promise.resolve([]);
  } else {
    return Promise.all(mongos.map(function(mongo) {
      return getDiskNames(req, mongo);
    }));
  }
}
// this route actually queries the Atlas API for data
app.all('/query', function(req, res){
  setHeaders(res);

  // console.log(req.body);

  const allTargets = _.map(req.body.targets, 'target');
  const hostTargets = _.filter(allTargets, (t) => _.includes(PROCESS_MEASUREMENT_VALUES, t));
  const diskTargets = _.filter(allTargets, (t) => _.includes(DISK_MEASUREMENT_VALUES, t));

  // https://docs.atlas.mongodb.com/reference/api/process-measurements/#request-query-parameters
  let granularity = null;
  const intervalSeconds = req.body.intervalMs / 1000;
  if (intervalSeconds <= 60) {
    granularity = 'PT1M';
  } else if (intervalSeconds <= 500) {
    granularity = 'PT5M';
  } else if (intervalSeconds <= 3600) {
    granularity = 'PT1H';
  } else {
    granularity = 'PT1D';
  }

  const baseAtlasRequestOptions = [
    ['start', req.body.range.from],
    ['end', req.body.range.to],
    ['granularity', granularity]
  ];



  getMongoHosts(req).then(function(mongos) {
    return getDisks(diskTargets, req, mongos).then(function(mongoDisks) {
      let requests = [];

      if (!_.isEmpty(diskTargets)) {
        let atlasRequestOptions = _.clone(baseAtlasRequestOptions);
        _.each(diskTargets, function(target) {
          atlasRequestOptions.push(['m', target]);
        });
        mongoDisks.map(function(mongoDisk) {
          mongoDisk.disks.map(function(disk) {
            requests.push(requestFromAtlas(`/groups/${req.auth.projectId}/processes/${mongoDisk.name}/disks/${disk}/measurements`, atlasRequestOptions));
          });
        });
      }

      if (!_.isEmpty(hostTargets)) {
        let atlasRequestOptions = _.clone(baseAtlasRequestOptions);
        _.each(hostTargets, function(target) {
          atlasRequestOptions.push(['m', target]);
        });
        mongos.map(function(mongo) {
          requests.push(requestFromAtlas(`/groups/${req.auth.projectId}/processes/${mongo}/measurements`, atlasRequestOptions));
        });
      }

      return Promise.all(requests);
    });
  }).then(function(responses) {
    let results = [];

    _.each(responses, function(response) {
      _.each(response.body.measurements, function(measurement) {
        let result = {
          target: `${PROCESS_MEASUREMENTS[measurement.name] || DISK_MEASUREMENTS[measurement.name]} (${response.body.processId})`,
          datapoints: []
        };
        _.each(measurement.dataPoints, function(dataPoint) {
          // TODO: why are we getting so many null values??
          if (dataPoint.value) {
            result.datapoints.push([dataPoint.value, timestampToEpoch(dataPoint.timestamp)]);
          }
        });
        results.push(result);
      });
    });

    res.json(results).end();
  }).catch(function(error) {
    console.log("ERROR:", error);
    res.status(500).json(error).end();
  });
});

app.listen(CONFIG.port);
console.log(`Server is listening to port ${CONFIG.port}`);
