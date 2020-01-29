const util = require('./_utils')
const logger = util.logger()
const parser = util.parser()
const randomid = util.randomid
const inherits = util.inherits
const EventEmitter = require('events').EventEmitter
const WebSocket = require('ws')
const q = require('q')

const _ = require('lodash')

function Session(socket, supportedRoles) {
    var self = this;

    if (!(socket instanceof WebSocket)) {
        throw new TypeError('wamp.error.invalid_socket');
    }

    if (!(_.isPlainObject(supportedRoles))) {
        throw new TypeError('wamp.error.invalid_roles');
    }

    EventEmitter.call(this);

    socket.on('open', function () {
        logger.debug('socket open');
    });

    socket.on('message', function (data) {
        logger.debug('socket message', data);
        self.parse(data);
    });

    socket.on('error', function (err) {
        logger.error('socket error', err.stack);
        self.close(null, null, false);
    });

    socket.on('close', function (code, reason) {
        logger.debug('socket close', code, reason || '');
        self.close(code, reason, code === 1000);
    });

    self.socket = socket;
    self.roles = supportedRoles;
}

inherits(Session, EventEmitter);

Session.prototype.send = function (type, opts) {
    var self = this;

    parser.encode(type, opts)
        .then(function (message) {
            logger.debug('trying to send message', message);
            WebSocket.prototype.send.call(self.socket, message, function () {
                logger.debug('%s message sent', type, message);
            });
        })
        .catch(function (err) {
            logger.error('cannot send %s message!', type, opts, err.stack);
        })
        .done();
};

Session.prototype.error = function (type, id, err) {
    var self = this;

    if (_.isString(type) && _.isNumber(id) && err instanceof Error) {
        return self.send('ERROR', {
            request: {
                type: type,
                id: id
            },
            details: {
                stack: err.stack
            },
            error: err.message,
            args: [],
            kwargs: {}
        });
    } else {
        throw new TypeError('wamp.error.invalid_argument');
    }
};

Session.prototype.close = function (code, reason, wasClean) {
    var self = this;

    if (code > 1006) {
        self.send('GOODBYE', {details: {message: 'Close connection'}, reason: reason});
    }

    var defer = q.defer();
    self.emit('close', defer);
    return defer.promise;
};

Session.prototype.parse = function (data) {
    var self = this;

    parser.decode(data)
        .then(function (message) {
            logger.debug('parsing message', message);
            switch (message.type) {
                case 'HELLO':
                    q.fcall(function () {
                        self.id = randomid();
                        self.realm = message.realm;

                        var defer = q.defer();
                        self.emit('attach', message.realm, defer);
                        return defer.promise;
                    })
                        .then(function () {
                            return self.send('WELCOME', {
                                session: {
                                    id: self.id
                                },
                                details: {
                                    roles: self.roles
                                }
                            });
                        })
                        .then(function () {
                            logger.debug('attached session to realm', message.realm);
                        })
                        .catch(function (err) {
                            logger.error('cannot establish session', err.stack);
                            self.send('ABORT', {
                                details: {
                                    message: 'Cannot establish session!'
                                },
                                reason: err.message
                            });
                        })
                        .done();
                    break;
                case 'GOODBYE':
                    self.close(1009, 'wamp.error.close_normal');
                    break;
                case 'SUBSCRIBE':
                    q.fcall(function () {
                        logger.debug('try to subscribe to topic:', message.topic);
                        var defer = q.defer();
                        self.emit('subscribe', message.topic, defer);
                        return defer.promise;
                    })
                        .then(function (subscriptionId) {
                            self.send('SUBSCRIBED', {
                                subscribe: {
                                    request: {
                                        id: message.request.id
                                    }
                                },
                                subscription: {
                                    id: subscriptionId
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot subscribe to topic', self.realm, message.topic, err.stack);
                            self.error('SUBSCRIBE', message.request.id, err);
                        })
                        .done();
                    break;
                case 'UNSUBSCRIBE':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('unsubscribe', message.subscribed.subscription.id, defer);
                        return defer.promise;
                    })
                        .then(function () {
                            self.send('UNSUBSCRIBED', {
                                unsubscribe: {
                                    request: {
                                        id: message.request.id
                                    }
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot unsubscribe from topic', message.subscribed.subscription.id, err.stack);
                            self.error('UNSUBSCRIBE', message.request.id, err);
                        })
                        .done();
                    break;
                case 'PUBLISH':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('publish', message.topic, defer);
                        return defer.promise;
                    })
                        .then(function (topic) {
                            var publicationId = randomid();

                            if (message.options && message.options.acknowledge) {
                                self.send('PUBLISHED', {
                                    publish: {
                                        request: {
                                            id: message.request.id
                                        }
                                    },
                                    publication: {
                                        id: publicationId
                                    }
                                });
                            }

                            var queue = [];
                            _.forEach(topic.sessions, function (session) {
                                var event = session.send('EVENT', {
                                    subscribed: {
                                        subscription: {
                                            id: topic.id
                                        }
                                    },
                                    published: {
                                        publication: {
                                            id: publicationId
                                        }
                                    },
                                    details: {},
                                    publish: {
                                        args: message.args,
                                        kwargs: message.kwargs
                                    }
                                });

                                queue.push(event);
                            });

                            return q.all(queue);
                        })
                        .then(function () {
                            logger.info('published event to topic', message.topic);
                        })
                        .catch(function (err) {
                            logger.error('cannot publish event to topic', message.topic, err.stack);
                            self.error('PUBLISH', message.request.id, err);
                        })
                        .done();
                    break;
                case 'REGISTER':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('register', message.procedure, defer);
                        return defer.promise;
                    })
                        .then(function (registrationId) {
                            self.send('REGISTERED', {
                                register: {
                                    request: {
                                        id: message.request.id
                                    }
                                },
                                registration: {
                                    id: registrationId
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot register remote procedure', message.procedure, err.stack);
                            self.error('REGISTER', message.request.id, err);
                        })
                        .done();
                    break;
                case 'UNREGISTER':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('unregister', message.registered.registration.id, defer);
                        return defer.promise;
                    })
                        .then(function () {
                            self.send('UNREGISTERED', {
                                unregister: {
                                    request: {
                                        id: message.request.id
                                    }
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot unregister remote procedure', message.registered.registration.id, err.stack);
                            self.error('UNREGISTER', message.request.id, err);
                        })
                        .done();
                    break;
                case 'CALL':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('call', message.procedure, defer);
                        return defer.promise;
                    })
                        .then(function (procedure) {
                            var invocationId = procedure.invoke(message.request.id, self);
                            procedure.callee.send('INVOCATION', {
                                request: {
                                    id: invocationId
                                },
                                registered: {
                                    registration: {
                                        id: procedure.id
                                    }
                                },
                                details: {},
                                call: {
                                    args: message.args,
                                    kwargs: message.kwargs
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot call remote procedure', message.procedure, err.stack);
                            self.error('CALL', message.request.id, err);
                        })
                        .done();
                    break;
                case 'YIELD':
                    q.fcall(function () {
                        var defer = q.defer();
                        self.emit('yield', message.invocation.request.id, defer);
                        return defer.promise;
                    })
                        .then(function (invocation) {
                            invocation.session.send('RESULT', {
                                call: {
                                    request: {
                                        id: invocation.requestId
                                    }
                                },
                                options: {},
                                yield: {
                                    args: message.args,
                                    kwargs: message.kwargs
                                }
                            });
                        })
                        .catch(function (err) {
                            logger.error('cannot yield remote procedure', message.request.id, err.stack);
                        })
                        .done();
                    break;
                case 'ERROR':
                    switch (parser.TYPES[message.request.type].type) {
                        case 'INVOCATION':
                            q.fcall(function () {
                                var defer = q.defer();
                                self.emit('yield', message.request.id, defer);
                                return defer.promise;
                            })
                                .then(function (invocation) {
                                    logger.error('trying to send error message for:', message);
                                    invocation.session.send('ERROR', {
                                        request: {
                                            type: 'CALL',
                                            id: invocation.requestId
                                        },
                                        details: message.details,
                                        error: message.error,
                                        args: message.args,
                                        kwargs: message.kwargs
                                    });
                                })
                                .catch(function (err) {
                                    logger.error('cannot respond to invocation error!', message.request.id, err.stack);
                                })
                                .done();
                            break;
                        default:
                            logger.error('error response for message type %s is not implemented yet!', message.request.type);
                    }
                    break;
                default:
                    logger.error('wamp.error.not_implemented');
            }
        })
        .catch(function (err) {
            logger.error('session parse error!', err.stack);
            self.close(1011, 'wamp.error.internal_server_error');
        })
        .done();
};

module.exports = Session;
