var {ipcRenderer} = require('electron');
var requireScript = require('./require.js');
var config = require('./config.js');

var rpcCallID = 1;
var rpcCallTask = [];
const rpcCallTimeout = config.rpcCallTimeout;

setInterval(() => {
    var now = new Date();
    var job;
    while(job = rpcCallTask.shift()) {
        if(now - job.startTime >= rpcCallTimeout) {
            job.reject(new Error('local_timeout'));
        } else {
            rpcCallTask.unshift(job);
            break;
        }
    }
}, rpcCallTimeout);

function reply(msg) {
    ipcRenderer.send('browser-reply', msg);
}

function nodeReply(rep) {
    if(rep.id == null) {
        console.error('ipc node-reply, invalid reply', JSON.stringify(rep));
        return;
    }

    var job = rpcCallTask.shift();
    if(!job) {
        console.error('ipc node-reply, notfound', JSON.stringify(rep));
        return;
    }
    if(job.id === rep.id) {
        //99%的概率会走这里，因此，本算法效率实际最高
         _handleResponse(rep, job);
        return;
    }

    rpcCallTask.unshift(job);

    for(var i=0,L=rpcCallTask.length;i<L;i++) {
        var job = rpcCallTask[i];
        if(job.id === rep.id) {
            _handleResponse(rep, job);
            rpcCallTask = rpcCallTask.slice(0,i).concat(rpcCallTask.slice(i+1));
            break;
        }
    }
}

function callNode(script, ...args) {
    if(!script) {
        return Promise.reject(new Error('invalid arguments'));
    }

    var str = requireScript(script);

    /* don't edit */
    var inject = `${rpcCallID}\nreturn ${str}.apply(null,${JSON.stringify(args)})`;

    return new Promise(function(resolve, reject) {
        var job = {
            id: rpcCallID,
            startTime: new Date(),
            resolve: resolve,
            reject: reject
        };
        rpcCallTask.push(job);

        ipcRenderer.send('call-node', inject);
        
        if(++rpcCallID > 1024*1024*1024) {
            rpcCallID = 1;
        }
    });
}

function _handleResponse(rep, job) {
    switch(rep.type) {
        case 'Error':
            var e = new Error();
            e.message = rep.data.message;
            e.stack = rep.data.stack;
            return job.reject(e);
        case 'error':
            return job.reject(rep.data);
        default:
            return job.resolve(rep.data);
    }
}

window.nodeReply = nodeReply;
window.callNode = callNode;
window.reply = reply;

//console.log('------------preload------------');