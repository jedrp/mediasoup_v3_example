'use strict';

// --- web server ---
const webServer = require("./web_server.js")

// --- socket.io server ---
const io = require('socket.io')(webServer);
console.log('socket.io server start. port=' + webServer.address().port);


io.on('connection', function (socket) {
    console.log('client connected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());

    socket.on('disconnect', function () {
        // close user connection
        console.log('client disconnected. socket id=' + getId(socket) + '  , total clients=' + getClientCount());
    });
    socket.on('error', function (err) {
        console.error('socket ERROR:', err);
    });
    socket.on('connect_error', (err) => {
        console.error('client connection error', err);
    });
    socket.on('getRouterRtpCapabilities', (data, callback) => {
        console.log('fired getRouterRtpCapabilities: ');
        if (producerRouter) {
            console.log('getRouterRtpCapabilities: ', producerRouter.rtpCapabilities);
            sendResponse(producerRouter.rtpCapabilities, callback);
        }
        else {
            sendReject({ text: 'ERROR- router NOT READY' }, callback);
        }
    });

    socket.on('createProducerTransport', async (data, callback) => {
        console.log('-- createProducerTransport ---');
        producerSocketId = getId(socket);
        await conenctPipes(data.consumerPort);
        const { transport, params } = await createTransport(producerRouter);
        producerTransport = transport;
        producerTransport.observer.on('close', () => {
            if (videoProducer) {
                videoProducer.close();
                videoProducer = null;
            }
            if (audioProducer) {
                audioProducer.close();
                audioProducer = null;
            }
            producerTransport = null;
        });
        //console.log('-- createProducerTransport params:', params);
        sendResponse(params, callback);
    });
    socket.on('connectProducerTransport', async (data, callback) => {
        await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
        sendResponse({}, callback);
    });
    socket.on('produce', async (data, callback) => {
        const { kind, rtpParameters } = data;
        await conenctPipes(data.consumerPort);
        console.log('-- produce --- kind=', kind);
        if (kind === 'video') {
            videoProducer = await producerTransport.produce({ kind, rtpParameters });

            // -- auto pipe ---
            // await router1.pipeToRouter({ producerId: videoProducer.id, router: router2 }); // pipe router1 --> router2

            // -- manual pipe --
            let consumer = await pipeProducerToConsumer(videoProducer);


            videoProducer.observer.on('close', () => {
                console.log('videoProducer closed ---');
            })
            let response = { id: videoProducer.id, rtpParameters: consumer.pipeConsumer.rtpParameters, appData: videoProducer.appData };
            console.log("--------- response", response);
            sendResponse(response, callback);
        }
        else if (kind === 'audio') {
            audioProducer = await producerTransport.produce({ kind, rtpParameters });

            // -- auto pipe --
            // await router1.pipeToRouter({ producerId: audioProducer.id, router: router2 }); // pipe router1 --> router2

            // -- manual pipe --
            let consumer = await pipeProducerToConsumer(audioProducer);

            audioProducer.observer.on('close', () => {
                console.log('audioProducer closed ---');
            })
            let response = { id: videoProducer.id, rtpParameters: consumer.pipeConsumer.rtpParameters, appData: videoProducer.appData };
            console.log("--------- response", response);
            sendResponse(response, callback);
        }
        else {
            console.error('produce ERROR. BAD kind:', kind);
            //sendResponse({}, callback);
            return;
        }

        // inform clients about new producer
        console.log('--broadcast newProducer -- kind=', kind);
        socket.broadcast.emit('newProducer', { kind: kind });
    });
    // ---- sendback welcome message with on connected ---
    const newId = getId(socket);
    sendback(socket, { type: 'welcome', id: newId });
    function sendResponse(response, callback) {
        //console.log('sendResponse() callback:', callback);
        callback(null, response);
    }
    function sendReject(error, callback) {
        callback(error.toString(), null);
    }

    function sendback(socket, message) {
        socket.emit('message', message);
    }
});


const mediasoup = require("mediasoup");
const mediasoupOptions = require("./config.js");
let producerWorker = null;
let producerRouter = null;
let producerTransport = null;
let producerPipeTransport = null;
let videoProducer = null;
let audioProducer = null;
let producerSocketId = null;
let pipeConnected = false;

async function startProducerWoker() {
    const mediaCodecs = mediasoupOptions.router.mediaCodecs;
    producerWorker = await mediasoup.createWorker();
    producerRouter = await producerWorker.createRouter({ mediaCodecs });
    producerPipeTransport = await producerRouter.createPipeTransport({
        listenIp: "192.168.1.120"
    })
    console.log("======== producer transport info", producerPipeTransport.tuple);
    console.log('-- mediasoup worker start. --')
}
startProducerWoker();

async function createTransport(router) {
    const transport = await router.createWebRtcTransport(mediasoupOptions.webRtcTransport);
    console.log('-- create transport id=' + transport.id);

    return {
        transport: transport,
        params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        }
    };
}

// --- manual pipe --
async function pipeProducerToConsumer(producer) {
    let pipeConsumer;
    let pipeProducer;

    try {
        pipeConsumer = await producerPipeTransport.consume(
            {
                producerId: producer.id,
                paused: producer.paused
            });

        console.log("--------- pipe consumer ", pipeConsumer.rtpParameters)
        // Pipe events from the pipe Consumer to the pipe Producer.
        pipeConsumer.observer.on('close', () => pipeProducer.close());
        pipeConsumer.observer.on('pause', () => pipeProducer.pause());
        pipeConsumer.observer.on('resume', () => pipeProducer.resume());

        return { pipeConsumer };
    }
    catch (error) {
        console.error(
            'pipeToRouter() | error creating pipe Consumer/Producer pair:%o',
            error);

        if (pipeConsumer)
            pipeConsumer.close();

        throw error;
    }
}

function getId(socket) {
    return socket.id;
}

function getClientCount() {
    // WARN: undocumented method to get clients number
    return io.eio.clientsCount;
}

async function conenctPipes(consumerPort) {
    console.log("--------- consumer port", consumerPort);
    if (pipeConnected) {
        return;
    }
    try {

        await producerPipeTransport.connect(
            {
                ip: "192.168.1.120",
                port: consumerPort
            });

        producerPipeTransport.observer.on('close', () => {
            console.log('==== pipeTransport1 closed ======');
            pipeTransport2.close();
        });
        pipeConnected = true;
    }
    catch (err) {
        console.error('pipeTransport ERROR:', err);
        if (producerPipeTransport) {
            producerPipeTransport.close();
            producerPipeTransport = null;
        }
    }
}