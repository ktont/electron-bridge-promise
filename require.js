var path = require('path');
var fs = require('fs');

var scriptMap = {};
var functionMap = {};

module.exports = function(script) {
    if(typeof script === 'function') {
        var name = script.name;
        if(name) {
            if(functionMap[name]) functionMap[name] = '('+script.toString()+')';
            return functionMap[name];
        } else {
            return '('+script.toString()+')';
        }
    } else {
        var absPath = path.resolve(script);
        if(scriptMap[absPath]) {
            return scriptMap[absPath];
        }

        if(!fs.existsSync(absPath)) {
            throw new Error(absPath+' notfound');
        }

        var str = fs.readFileSync(absPath, 'ascii') + '\n';
        if(/^[ \r\n\t]*function/.test(str)) {
            scriptMap[absPath] = str;
        } else {
            scriptMap[absPath] = '(function (){'+str+'})';
        }
        
        return scriptMap[absPath];
    }
}


