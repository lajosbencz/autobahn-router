const CConf = require('node-cconf')
const util = require('./_utils')
const logger = util.logger()
const parser = util.parser()
const randomid = util.randomid
const defer = util.defer
const Realm = require('./realm')
const Session = require('./session')
const ws = require('ws')
const q = require('q')
const http = require('http')
const _ = require('lodash')


class Router extends ws.Server {
    async constructor(opts) {

        let config = new CConf('router', [], {
            path: '/',
            autoCreateRealms: true
        }).load(opts || {});

        logger.info('router option for auto-creating realms is', config.getValue('autoCreateRealms') ? 'set' : 'not set');

        let server = config.getValue('httpServer');
        if (!server) {
            server = http.createServer((req, res) => {
                res.writeHead(200);
                res.end('This is the Nightlife-Rabbit WAMP transport. Please connect over WebSocket!');
            });
        }

        server.on('error', (err) => {
            logger.error('httpServer error:', err.stack);
        });

        let port = config.getValue('port');
        if (port) {
            server.listen(port, () => {
                logger.info('bound and listen at:', port);
            });
        }

        const defer = defer();

        super({
            'server': server,
            'path': config.getValue('path')
        });

        this.on('error', (err) => {
            logger.error('webSocketServer error:', err.stack);
        });

        this.on('connection', (socket) => {
            logger.info('incoming socket connection');

            const session = new Session(socket, this.roles);

            defer.resolve(socket);

            session.on('attach', (realm, defer) => {
                try {
                    logger.debug('attaching session to realm', realm);
                    this.realm(realm).addSession(session);
                    defer.resolve();
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('close', (defer) => {
                try {
                    logger.debug('removing & cleaning session from realm', session.realm);
                    this.realm(session.realm).cleanup(session).removeSession(session);
                    defer.resolve();
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('subscribe', (uri, defer) => {
                try {
                    defer.resolve(this.realm(session.realm).subscribe(uri, session));
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('unsubscribe', (id, defer) => {
                try {
                    this.realm(session.realm).unsubscribe(id, session);
                    defer.resolve();
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('publish', (uri, defer) => {
                try {
                    defer.resolve(this.realm(session.realm).topic(uri));
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('register', (uri, defer) => {
                try {
                    defer.resolve(this.realm(session.realm).register(uri, session));
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('unregister', (id, defer) => {
                try {
                    this.realm(session.realm).unregister(id, session);
                    defer.resolve();
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('call', (uri, defer) => {
                try {
                    defer.resolve(this.realm(session.realm).procedure(uri));
                } catch (err) {
                    defer.reject(err);
                }
            });

            session.on('yield', (id, defer) => {
                try {
                    defer.resolve(this.realm(session.realm).yield(id));
                } catch (err) {
                    defer.reject(err);
                }
            });
        });

        this.config = config;
        this.server = server;
        this.realms = {};
    }

    get roles() {
        return {
            broker: {},
            dealer: {}
        };
    }

    close() {
        return q.fcall(() => {
            _.forOwn(this.realms, (realm) => {
                realm.close(1008, 'wamp.error.system_shutdown');
            });
        })
            .then(() => {
                this.server.close();
                super.close();
            })
            .timeout(500, 'wamp.error.system_shutdown_timeout');
    }

    realm(uri) {
        if (parser.isUri(uri)) {
            let realms = this.realms;
            let autoCreateRealms = this.config.getValue('autoCreateRealms');

            if (!realms[uri]) {
                if (autoCreateRealms) {
                    realms[uri] = new Realm();
                    logger.info('new realm created', uri);
                } else {
                    throw new Error('wamp.error.no_such_realm');
                }
            }

            return realms[uri];
        } else {
            throw new TypeError('wamp.error.invalid_uri');
        }
    }

    createRealm(uri) {
        if (parser.isUri(uri)) {
            var realms = this.realms;
            if (!realms[uri]) {
                realms[uri] = new Realm();
                logger.info('new realm created', uri);
            } else {
                throw new Error('wamp.error.realm_already_exists');
            }
        } else {
            throw new TypeError('wamp.error.invalid_uri');
        }
    }
}


module.exports = Router
module.exports.createRouter = function (opts) {
    return new Router(opts);
};
