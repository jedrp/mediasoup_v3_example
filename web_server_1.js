const fs = require('fs');
let serverOptions = {
    hostName: "localhost",
    listenPort: 3001,
    useHttps: false
};
let sslOptions = {};
if (serverOptions.useHttps) {
    sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
    sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

// --- prepare server ---
const http = require("http");
const https = require("https");
const express = require('express');

const app = express();
const webPort = serverOptions.listenPort;
app.use(express.static('public'));

let webServer = null;
if (serverOptions.useHttps) {
    // -- https ---
    webServer = https.createServer(sslOptions, app).listen(webPort, function () {
        console.log('Web server start. https://' + serverOptions.hostName + ':' + webServer.address().port + '/');
    });
}
else {
    // --- http ---
    webServer = http.Server(app).listen(webPort, function () {
        console.log('Web server start. http://' + serverOptions.hostName + ':' + webServer.address().port + '/');
    });
}

// --- file check ---
function isFileExist(path) {
    try {
        fs.accessSync(path, fs.constants.R_OK);
        //console.log('File Exist path=' + path);
        return true;
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            //console.log('File NOT Exist path=' + path);
            return false
        }
    }

    console.error('MUST NOT come here');
    return false;
}

module.exports = webServer;