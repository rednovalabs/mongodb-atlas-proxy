# MongoDB Atlas Proxy

This is a small node.js proxy that aids in getting your MongoDB Atlas metrics into Grafana. It takes requests from the Grafana datasource [SimpleJSON](https://github.com/grafana/simple-json-datasource) and forwards them to the [Atlas API](https://docs.atlas.mongodb.com/reference/api/monitoring-and-logs/).

# Usage
```
git clone
yarn install
ATLAS_USERNAME=foo@bar.com ATLAS_API_TOKEN=dead-beef node index.js
```
