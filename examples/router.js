process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const nightlife = require('../lib')
const autobahn = require('autobahn')
const http = require('http')
const fs = require('fs');

// Create a secure webserver as transport for the WebSocket connections.
var transport = http.createServer({}, function (req, res) {
    res.writeHead(200);
    res.end('Please connect per WebSocket!');
});

// Create a router which use previously created webserver,
// listen on specified port and path and don't create realms
// automatically when requested. The router constructor itself
// call the webserver.listen method and reject new sessions,
// if the requested realm doesn't exists.
var router = nightlife.createRouter({
    httpServer: transport,
    port: 4000,
    path: '/',
    autoCreateRealms: false
});

// Create an example realm.
router.createRealm('com.example.inge');

var logger = console;

// Create an example service which return a random integer when called.
// This service maybe runs on a different machine or in the browser.
var serviceA = new autobahn.Connection({
    url: 'ws://localhost:4000/',
    realm: 'com.example.inge'
});

serviceA.onopen = function (session) {
    session.register('com.example.random', function (args, kwargs, details) {
        return Math.floor(Math.random() * Math.pow(2, 53));
    })
        .then(function (registration) {
            logger.info('service with id %d registered.', registration.id);
        })
        .catch(function (err) {
            logger.error('cannot register service!');
            process.exit(2);
        })
        .done();
};

serviceA.onclose = function (reason) {
    logger.info('service closed', reason);
    process.exit(2);
};

setTimeout(function () {
    serviceA.open();
}, 500);

// Create an example service which will populate the
// current datetime every two secundes.
// Clients can subscribe to this topic in the same manner.
var serviceB = new autobahn.Connection({
    url: 'ws://localhost:4000/',
    realm: 'com.example.inge'
});

serviceB.onopen = function (session) {
    session.subscribe('com.example.time', function () {
    })
        .then(function (subscription) {
            logger.info('subscribed to topic.', subscription.id);

            setInterval(function () {
                session.publish('com.example.time', [new Date().getTime()]);
            }, 1927);
        })
        .catch(function (err) {
            logger.error('cannot subscribe to topic!', err);
        })
        .done();
};

serviceB.onclose = function (reason) {
    logger.info('service closed', reason);
    process.exit(2);
};

setTimeout(function () {
    serviceB.open();
}, 500);
