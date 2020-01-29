
const MessageParser = require('./message-parser')

var parser;
module.exports.parser = function (opts) {
    if (!(parser instanceof MessageParser) || opts) {
        parser = new MessageParser(opts);
    }
    return parser;
};

module.exports.logger = function(opts) {
    //return console;
    return {
        error() {},
        debug() {},
        info() {},
    };
};

module.exports.randomid = function () {
    return Math.floor(Math.random() * Math.pow(2, 53));
};


module.exports.inherits = function(childObj, parentObj) {
    let tmpObj = function () {}
    tmpObj.prototype = parentObj.prototype;
    childObj.prototype = new tmpObj();
    childObj.prototype.constructor = childObj;
};

module.exports.defer = function defer() {
    return (() => {
        let resolve = null;
        let reject = null;
        let promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return {
            promise,
            reject,
            resolve
        };
    })();
};
