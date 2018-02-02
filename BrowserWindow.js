var {ipcMain, app, BrowserWindow: BrowserWindowRaw} = require('electron');
var requireScript = require('./require.js')
var config = require('./config.js');


class BrowserWindow extends BrowserWindowRaw {
  constructor(params) {

    _validateParamBridgeTimeout(params);
    _validateParamWebPreferences(params);

    super(params);

    this.rpcCallID = 0;
    this.rpcCallTask = [];
    this.rpcCallTimer = null;
    this.rpcCallTimeout = params.bridgeTimeout;

    //用户指定的preload脚本。延迟执行
    this.userPreloadScript = params.userPreloadScript;

    this.installNodeRPC = this.installNodeRPC.bind(this);
    this.installChromeRPC = this.installChromeRPC.bind(this);

    this.installNodeRPC();
    this.installChromeRPC();

    this.webContents.setUserAgent(config.ua);

    if(params.dev !== false) {
      this.openDevTools();
    }

    this.execUserPreloadScript();
  }

  // 初始化 node 远程调用通道
  installNodeRPC() {
    var cont = this.webContents;
    ipcMain.on('call-node', (event, rep) => {
        //console.log('call-node in class:', typeof rep, rep);
        if(typeof rep !== 'string') {
            console.error('非法的call-node消息', rep);
            return;
        }
        const sp = rep.match(/^([0-9]+)\n/);
        if(!sp || sp.length !== 2) {
            console.error('call-node消息解析失败', rep);
            return;
        }

        const id = Number(sp[1]);
        const body = rep.substr(sp[1].length+1);

        let pack;
        let ret;

        try {
            ret = new Function(/*你可以通过参数控制访问权限*/body)();
        } catch(err) {
            pack = {
                id,
                type:'Error',
                data:{
                    message: err.message,
                    stack: err.stack
                }
            };
            cont.executeJavaScript(`nodeReply(${JSON.stringify(pack)})`);
            return;
        }

        //no promise
        if(typeof ret!=="object" || !ret.then) {
            pack = {id, data:ret};
            cont.executeJavaScript(`nodeReply(${JSON.stringify(pack)})`);
            return;
        }

        ret.then(data => {
            pack = {id,data};
            cont.executeJavaScript(`nodeReply(${JSON.stringify(pack)})`);
            return;
        })
        .catch(err => {
            if(err instanceof Error) {
                pack = {
                    id,
                    type:'Error',
                    data:{
                        message: err.message,
                        stack: err.stack
                    }
                };
            } else {
                pack = {id,type:'error',data:err};
            }
            cont.executeJavaScript(`nodeReply(${JSON.stringify(pack)})`);
            return;
        });
    });
  }

  // 初始化 chrome 远程调用通道
  installChromeRPC() {
    this.rpcCallTimer = setInterval(() => {
        var now = new Date();
        var job;
        while(job = this.rpcCallTask.shift()) {
            if(now - job.startTime >= this.rpcCallTimeout) {
                job.reject(new Error('local_timeout'));
            } else {
                //??
                this.rpcCallTask.unshift(job);
                break;
            }
        }
    }, this.rpcCallTimeout);

    ipcMain.on('browser-reply', (event, rep) => {
        //console.log('browser-reply in class:', typeof rep, rep);
        if(rep.id == null) {
            console.error('ipc browser-reply, invalid reply', JSON.stringify(rep));
            return;
        }
        
        var job = this.rpcCallTask.shift();
        if(!job) {
            console.error('ipc browser-reply, notfound', JSON.stringify(rep));
            return;
        }
        if(job.id === rep.id) {
            //99%的概率会走这里，因此，本算法效率实际最高
             _handleResponse(rep, job);
            return;
        }

        this.rpcCallTask.unshift(job);
        
        for(var i=0,L=this.rpcCallTask.length;i<L;i++) {
            var job = this.rpcCallTask[i];
            if(job.id === rep.id) {
                _handleResponse(rep, job);
                this.rpcCallTask = this.rpcCallTask.slice(0,i).concat(this.rpcCallTask.slice(i+1));
                break;
            }
        }
    });
  }

  execUserPreloadScript() {
      if(!this.userPreloadScript) return;
      var inject = requireScript(this.userPreloadScript);
      this.webContents.executeJavaScript(inject+'()');
  }

  /*
   * url: 打开url
   *   本方法考虑了 302，它会打开最终目标页。当然，不过页面没有 302，那是最好。
   *   直接到达目标页。
   * 返回promise, resolve，最终url
   */
  openURL302(uri) {
    var cont = this.webContents;
    
    this.loadURL(uri);
    
    return new Promise((resolve, reject) => {
      var finalUri;
      function listenerN(e, newuri) {
        finalUri = newuri;
      };
      function listenerD() {
        setTimeout(() => {
          var uri = cont.getURL();
          if(finalUri) {
            //console.log('navigate to:', finalUri);
            if(uri === finalUri) {
              cont.removeListener('dom-ready', listenerD);
              cont.removeListener('will-navigate', listenerN);
              resolve(finalUri);
            } else {
              //waiting for you
            }
          } else {
            cont.removeListener('dom-ready', listenerD);
            cont.removeListener('will-navigate', listenerN);
            resolve(uri);
          }
        }, 0);
      };
      cont.on('will-navigate', listenerN);
      cont.on('dom-ready', listenerD);
    });
  }

  /*
   * url: 打开url
   *   url需要指定成跳转的最终页面，不帮助跳转到最终页
   *   上面这句话的含义是：
   *   考虑这种情况，请求列表页  /list  它返回 302 到 /login 页
   *   我们是不会帮助用户再去 302 跳转的
   *     this.openUrlDomReady 用来解决 302 的问题
   * 返回promise, resolve，当前url
   */
  openURL(uri) {
      var cont = this.webContents;
      this.loadURL(uri);
      return new Promise(function(resolve, reject) {
          cont.once('dom-ready', function() {
              resolve(uri);
          });
      });
  }

  /*
   * 目前你在 node 进程下，去 chrome 环境中执行一段 js，就要用的下面的方法
   * 参数：
   *     func, arg1, arg2, arg3, ...
   *     func是要在chronmium的js环境中执行的函数
   *     arg1 - arg3 是传递给func的参数
   *   或者，你可以指定文件
   *     filename, arg1, arg2, arg3, ...
   *     filename 是你想注入到前端的js脚本
   *     arg1 - arg3 是传递给前端脚本的参数
   * 返回值：
   *   promise 
   *     resolve你的 js 片段执行结果，
   *     reject 执行出错，chrome 中的 Error 对象，会尽量保持原样，发送到 node 进程中
   */
  callChrome(script, ...args) {
    if(!script) {
      return Promise.reject(new Error('invalid arguments'));
    }
    
    var str = requireScript(script);

    if(this.rpcCallID++ > 1024*1024*1024) {
        this.rpcCallID = 1;
    }
    args.unshift(this.rpcCallID);

    /* don't edit */
    var inject = `
    (function(){
    var n=arguments[0];
    var a=[].slice.call(arguments,1);
    var r=${str}.apply(null,a);
    if(typeof r!=="object" || !r.then) return reply({id:n,data:r});
    r.then(function(d){
    reply({id:n,data:d});
    })
    .catch(function(e){
    if(e instanceof Error) 
    return reply({id:n,type:'Error',data:{message:e.message, stack:e.stack}});
    reply({id:n,type:'error',data:e});
    });
    }).apply(null,${JSON.stringify(args)});
    `;
  
    //window.reply({id:n,data:{err:"F12 ERROR:"+msg+"\\n"+url+":"+line}});\
    //console.log('inject: ', inject, '|');
    
    return new Promise((resolve, reject) => {
      var job = {
        id: this.rpcCallID,
        startTime: new Date(),
        resolve: resolve,
        reject: reject
      };
      this.rpcCallTask.push(job);
      this.webContents.executeJavaScript(inject);
    });
  }

  setUserAgent(ua) {
    this.webContents.setUserAgent(ua);
  }
}

////////////////////////////function/////////////////////////////

function _validateParamBridgeTimeout(params) {
    if(params.bridgeTimeout == null) {
      params.bridgeTimeout = config.rpcTimeout10;
      return;
    }

    if(typeof bridgeTimeout !== 'Number') {
      throw new Error('bridgeTimeout 必须是数字');
    }
      
    if(bridgeTimeout < 3000 || bridgeTimeout > 600000) {
      throw new Error('bridgeTimeout 必须在 3 秒 到 600 秒之间')
    }
    return;
}

function _validateParamWebPreferences(params) {
  if(params.webPreferences == null) {
    params.webPreferences = {};
  }

  if(params.webPreferences.nodeIntegration !== false) {
    //electron-bridge 希望你不要关注这个选项。
    //当然，当你设为 false，我想你很清楚自己在做什么，我就不管了。
    params.webPreferences.nodeIntegration = true;
  }

  if(params.webPreferences.preload) {
    params.userPreloadScript = params.webPreferences.preload;
    //throw new Error('electron-bridge 接管了 preload 脚本，暂时不支持自己设置它');
  }

  params.webPreferences.preload =  __dirname + '/preload.js';
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

module.exports = BrowserWindow;
