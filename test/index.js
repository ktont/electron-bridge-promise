var { app } = require('electron');
var BrowserWindow = require('../BrowserWindow.js');

app.on('window-all-closed', function() {
    app.quit();
});

app.on('ready', function() {
    var win = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            preload:  __dirname + '/user_perload.js'
        },
        moduleAttachToWindow: [
            {from: 'fs', to: 'FS'}
        ]
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
