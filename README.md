# electron-bridge-promise

## 用法

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <title>Hello World!</title>
  </head>
  <body>
    <h1>Hello World!</h1>
    We are using Node.js
    <script>
        document.write(process.version);
    </script>
    and Electron <script>document.write(process.versions['electron'])</script>.
  </body>
</html>
```

```js
var {ipcMain, app} = require('electron');
var BrowserWindow = require('electron-bridge-promise');

app.on('window-all-closed', function() {
    app.quit();
});

app.on('ready', function() {
    var win = new BrowserWindow({
        width: 1024,
        height: 768,
    });

    win.openURL('file://' + __dirname + '/app.html')
    .then((uri) => {
        console.log('open ready: ', uri);
        return win.callChrome(()=>{
            console.log('i am in chrome');
            return new Promise((resolve, reject) => {
                setTimeout(()=>{
                    console.log('log from node');
                    resolve('abc');
                },1000);
            });
        });
    })
    .then(function(ret) {
        console.log('retttttttt', typeof ret, ret);
    })
    .catch(function(err) {
        console.log('errrrrrrrr', typeof err, err instanceof Error, err, err.stack);
    });
});
```

```base 
# 把上面的 程序分别保存为 app.html 和 above.js，然后执行用 Electron 执行 above.js
$ Electron.app/Contents/MacOS/Electron above.js
```

![](/_img/1.png)

然后，在 devTool 下执行下面这段 js 片段

```js
window.callNode(function(name) {
    console.log('i am in node');
    return new Promise((resolve, reject) => {
        setTimeout(resolve, 1000, name);
    });
}, 'moon')
.then(name => {
    console.log('i am in chrome', name);
})
.catch(err => console.log('errr name', err));
```

![](/_img/2.png)

## moduleAttachToWindow 属性

['fs', 'request', 'md5sum']

指定要挂在 window 上的模块名字

模块的查找规则，同node的模块查找规则



## bridgeTimeout 属性 

bridgeTimeout 用来设定桥通信的超时时间，毫秒单位。

比如，你在 chrome 中执行一个异步任务，但是这个异步任务迟迟不能完成。那就会引发超时。

这个超时时间有个范围，必须在 3 秒 到 600 秒之间。默认值是 10 秒

```js
    var win = new BrowserWindow({
        bridgeTimeout: 10000,
    });
```

## dev 属性 

用来设置打开devTools 默认值 true

帮助你自动执行 window.openDevTools()
因为开发的时候 devTools 的使用频率太高了

当设置为 false 时，不会打开 openDevTools，并且禁止打开 openDevTools（无论如何都打不开开发工具）

## openURL302(url) 方法

打开url
本方法考虑了 302，它会打开最终目标页。当然，如果页面没有 302，那是最好，直接到达目标页。
返回promise, resolve 最终的 url。


## openURL(url) 方法

打开url
url需要指定成跳转的最终页面，不帮助跳转到最终页
返回promise, resolve 当前 url

## callChrome(script, ...args)

```text
目前你在 node 进程下，去 chrome 环境中执行一段 js，就要用的该方法
参数：
    func, arg1, arg2, arg3, ...
    func是要在chronmium的js环境中执行的函数
    arg1 - arg3 是传递给func的参数
  或者，你可以指定文件
    filename, arg1, arg2, arg3, ...
    filename 是你想注入到前端的js脚本
    arg1 - arg3 是传递给前端脚本的参数
返回值：
  script 中包含的函数的返回值。推荐你写的脚本返回 promise。
  如果是 promise 的话： 
    resolve你的 js 片段执行结果，
    reject 执行出错，chrome 中的 Error 对象，会尽量保持原样，发送到 node 进程中

关于超时：见 #bridgeTimeout ，默认情况下，你的脚本当超过 10 秒还没有返回，则会触发超时的 Error

## window.callNode(script, ...args)

假设你在 chrome 下，那么可以用  window.callNode 在 node 进程中执行代码。

参数和返回值的设计和 callChrome 一样。
```


# test

```sh
electron test/index.js
```
