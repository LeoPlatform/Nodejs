"use strict";

const mysql = require("mysql");
const logger = require("../../lib/logger")("connector.mysql");
const async = require("async");

const leo = require("../../index.js");
const ls = leo.streams;

const ID_LIMIT = 5000;
// const ID_LIMIT = 5;

module.exports = function(ID, config) {
  var m = mysql.createPool(Object.assign({
    host: "localhost",
    user: "root",
    port: 3306,
    database: "test",
    password: "",
    connectionLimit: 10
  }, config || {}));

  let oldquery = m.query.bind(m);
  let queryCount = 0;
  m.query = function(query, callback) {
    let queryId = ++queryCount;
    let log = logger.sub("query");
    log.info(`SQL query #${queryId} is `, query);
    log.time(`Ran Query #${queryId}`);
    oldquery(query, function(err, result, fields) {
      log.timeEnd(`Ran Query #${queryId}`);
      if (err) {
        log.error("Had error", err);
      }
      callback(err, result, fields);
    });
  }

  let log = logger.sub("process");
  return {
    loadEntities: function(queue, findSqls, builds, outQueue, opts, callback) {
      let checkpointer = ls.toManualCheckpoint(ID);
      let idLookups = {};
      let countIds = 0;

      let stream = leo.load(ID, outQueue, opts);
      let submit = () => {
        if (countIds == 0) {
          return Promise.resolve();
        }
        return this.findIds(idLookups, findSqls).then((ids) => {
          return this.buildEntities(ids, builds).then((entities) => {
            Object.keys(entities).forEach((id) => {
              stream.write(entities[id]);
            });
            checkpointer.flush(() => {
              idLookups = {};
              countIds = 0;
            });
          });
        });
      }
      ls.pipe(leo.read(ID, queue, opts), ls.through((obj, done) => {
        let p = null;
        if (countIds > ID_LIMIT || countIds == 0) {
          p = submit();
        } else {
          p = Promise.resolve(true);
        }


        p.then(() => {
          let payload = obj.payload;
          log.debug(obj.eid);
          Object.keys(findSqls).forEach(key => {
            if (key in payload) {
              if (!(key in idLookups)) {
                idLookups[key] = [];
              }
              countIds += payload[key].length;
              idLookups[key] = idLookups[key].concat(payload[key]);
            }
          });
          log.debug(`have ${countIds}`);
          done(null, obj);
        }, (err) => {
          console.log(err);
          done(err);
        })
      }, function finalize(done) {
        log.debug("Done", countIds);
        if (countIds) {
          submit().then(result => done(), done);
        } else {
          done();
        }
      }), checkpointer, (err) => {
        log.debug("done checkpointing", err);
        m.end();
        if (!err) {
          stream.end(() => {
            checkpointer.finish((err) => {
              log.debug("checkpointer finished", err);
              callback(err)
            });
          });
        } else {
          callback(err);
        }
      });
    },
    buildEntities: function(ids, builds, opts) {
      return new Promise((resolve, reject) => {
        log.debug(ids);

        if (ids.length == 0) {
          console.log("No entities to load");
          resolve({});
          return;
        }

        console.log(`Loading ${ids.length} entities`);
        let entities = {};
        let baseEvent = {};

        let tasks = [];
        if (!Array.isArray(builds)) {
          builds = [builds];
        }
        async.forEach(builds, (build, done) => {
          build.call({
            add: function(name, sql, transform) {
              if (typeof sql == 'function') {
                transform = sql;
                sql = name;
                name = null;
              } else if (!sql) {
                sql = name;
                name = null;
                transform = null;
              }
              let joinField = null;
              if (name) {
                var def = {};
                let [n, field] = name.split(/\./);
                name = n;
                joinField = field;

                if (name.match(/\[\]/)) {
                  def = [];
                  name = name.replace('[]', '');
                }

              }

              log.debug(name, sql, transform);
              if (name) {
                baseEvent[name] = def;
              }
              tasks.push((done) => {
                m.query(sql, (err, results, fields) => {
                  log.debug(err, results, fields);
                  if (!err) {
                    let firstColumn = fields[0].name;
                    results.forEach((row) => {
                      if (transform) {
                        row = transform(row);
                      }
                      if (name) {
                        let id = row[joinField];
                        if (Array.isArray(def)) {
                          entities[id][name].push(row);
                        } else {
                          entities[id][name] = row;
                        }
                      } else {
                        let id = row[firstColumn];
                        Object.assign(entities[id], row);
                      }
                    });
                  }
                  done(err);
                });
              });
            }
          }, ids, () => {
            console.log("DONE");
          });
        });
        ids.forEach(id => {
          entities[id] = {};
          for (var key in baseEvent) {
            if (Array.isArray(baseEvent[key])) {
              entities[id][key] = [];
            } else {
              entities[id][key] = {};
            }
          }
        });
        async.parallelLimit(tasks, 10, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(entities);
          }
        });
      });
    },
    findIds: (ids, sql, opts) => {
      return new Promise((resolve, reject) => {
        let tasks = [];
        let finalIds = [];
        Object.keys(sql).forEach(key => {
          if (sql[key] === true && key in ids) {
            finalIds = finalIds.concat(ids[key]);
          } else if (key in ids) {
            tasks.push((done) => {
              log.debug(ids, key);
              let s = sql[key].replace(/__IDS__/, ids[key].join());
              m.query(s, (err, results, fields) => {
                if (!err) {
                  let firstColumn = fields[0].name;
                  finalIds = finalIds.concat(results.filter(row => row[firstColumn]).map(row => row[firstColumn]));
                }
                done(err);
              });
            });
          }
        });
        async.parallelLimit(tasks, 10, (err, results) => {
          if (err) {
            reject(err);
          } else {
            resolve(finalIds.filter(function(e, pos, self) {
              return self.indexOf(e) === pos;
            }));
          }
        });
      });
    }
  }
};