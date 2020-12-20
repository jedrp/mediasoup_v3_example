'use strict';

// --- web server ---
const webServer = require("./web_server_1.js")

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
        if (consumerRouter) {
            console.log('getRouterRtpCapabilities: ', consumerRouter.rtpCapabilities);
            sendResponse(consumerRouter.rtpCapabilities, callback);
        }
        else {
            sendReject({ text: 'ERROR- router NOT READY' }, callback);
        }
    });
    socket.on('createConsumerTransport', async (data, callback) => {
        console.log('-- createConsumerTransport ---');
        await conenctPipes(data.producerPort);
        const { transport, params } = await createTransport(consumerRouter);
        addConsumerTrasport(getId(socket), transport);
        transport.observer.on('close', () => {
            const id = getId(socket);
            console.log('--- consumerTransport closed. --')
            let consumer = getVideoConsumer(getId(socket));
            if (consumer) {
                consumer.close();
                removeVideoConsumer(id);
            }
            consumer = getAudioConsumer(getId(socket));
            if (consumer) {
                consumer.close();
                removeAudioConsumer(id);
            }
            removeConsumerTransport(id);
        });
        //console.log('-- createTransport params:', params);
        sendResponse(params, callback);
    });
    socket.on('connectConsumerTransport', async (data, callback) => {
        console.log('-- connectConsumerTransport ---');
        let transport = getConsumerTrasnport(getId(socket));
        if (!transport) {
            console.error('transport NOT EXIST for id=' + getId(socket));
            sendResponse({}, callback);
            return;
        }
        await transport.connect({ dtlsParameters: data.dtlsParameters });
        sendResponse({}, callback);
    });
    socket.on('consume', async (data, callback) => {
        const kind = data.kind;
        await conenctPipes(data.producerPort)
        if (kind === 'video') {
            console.log('-- consume --data=' + data.producer.id);

            let transport = getConsumerTrasnport(getId(socket));
            if (!transport) {
                console.error('transport NOT EXIST for id=' + getId(socket));
                return;
            }
            await pipeProducerToRouter(data.producer, kind);

            const { consumer, params } = await createConsumer(transport, { id: data.producer.id, kind: 'video' }, data.rtpCapabilities); // producer must exist before consume
            //subscribeConsumer = consumer;
            const id = getId(socket);
            addVideoConsumer(id, consumer);
            consumer.observer.on('close', () => {
                console.log('consumer closed ---');
            })
            consumer.on('producerclose', () => {
                console.log('consumer -- on.producerclose');
                consumer.close();
                removeVideoConsumer(id);

                // -- notify to client ---
                socket.emit('producerClosed', { localId: id, remoteId: producerSocketId, kind: 'video' });
            });

            console.log('-- consumer ready ---');
            sendResponse(params, callback);
        }
        else if (kind === 'audio') {
            let transport = getConsumerTrasnport(getId(socket));
            if (!transport) {
                console.error('transport NOT EXIST for id=' + getId(socket));
                return;
            }
            const { consumer, params } = await createConsumer(transport, audioProducer, data.rtpCapabilities); // producer must exist before consume
            //subscribeConsumer = consumer;
            const id = getId(socket);
            addAudioConsumer(id, consumer);
            consumer.observer.on('close', () => {
                console.log('consumer closed ---');
            })
            consumer.on('producerclose', () => {
                console.log('consumer -- on.producerclose');
                consumer.close();
                removeAudioConsumer(id);

                // -- notify to client ---
                socket.emit('producerClosed', { localId: id, remoteId: producerSocketId, kind: 'audio' });
            });

            console.log('-- consumer ready ---');
            sendResponse(params, callback);
        }
        else {
            console.error('ERROR: UNKNOWN kind=' + kind);
        }
    });

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
let consumerWorker = null;
let consumerRouter = null;
let consumerPipeTransport = null;
let pipeConnected = false;

async function startConsumerWoker() {
    const mediaCodecs = mediasoupOptions.router.mediaCodecs;
    consumerWorker = await mediasoup.createWorker();
    consumerRouter = await consumerWorker.createRouter({ mediaCodecs });
    consumerPipeTransport = await consumerRouter.createPipeTransport({
        listenIp: "192.168.1.120"
    })
    console.log("======== consumer transport info", consumerPipeTransport.tuple);
}
startConsumerWoker();

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

async function pipeProducerToRouter(producerInfo, kind) {
    let pipeProducer;

    try {
        pipeProducer = await consumerPipeTransport.produce(
            {
                id: producerInfo.id,
                kind: kind,
                rtpParameters: producerInfo.rtpParameters,
                appData: producerInfo.appData,
                paused: false
            });
        console.log("===============pipeProducer ", pipeProducer);

        return { pipeProducer };
    }
    catch (error) {
        console.error(
            'pipeToRouter() | error creating pipe Consumer/Producer pair:%o',
            error);

        throw error;
    }
}

async function createConsumer(transport, producer, rtpCapabilities) {
    let consumer = null;
    if (!consumerRouter.canConsume(
        {
            producerId: producer.id,
            rtpCapabilities,
        })
    ) {
        console.error('can not consume');
        return;
    }

    consumer = await transport.consume({ // OK
        producerId: producer.id,
        rtpCapabilities,
        paused: false,
    }).catch(err => {
        console.error('consume failed', err);
        return;
    });

    return {
        consumer: consumer,
        params: {
            producerId: producer.id,
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            producerPaused: consumer.producerPaused
        }
    };
}


function getId(socket) {
    return socket.id;
}

let transports = {};
let videoConsumers = {};
let audioConsumers = {};

function getConsumerTrasnport(id) {
    return transports[id];
}

function addConsumerTrasport(id, transport) {
    transports[id] = transport;
    console.log('consumerTransports count=' + Object.keys(transports).length);
}

function removeConsumerTransport(id) {
    delete transports[id];
    console.log('consumerTransports count=' + Object.keys(transports).length);
}

function getVideoConsumer(id) {
    return videoConsumers[id];
}

function addVideoConsumer(id, consumer) {
    videoConsumers[id] = consumer;
    console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
}

function removeVideoConsumer(id) {
    delete videoConsumers[id];
    console.log('videoConsumers count=' + Object.keys(videoConsumers).length);
}

function getAudioConsumer(id) {
    return audioConsumers[id];
}

function addAudioConsumer(id, consumer) {
    audioConsumers[id] = consumer;
    console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}

function removeAudioConsumer(id) {
    delete audioConsumers[id];
    console.log('audioConsumers count=' + Object.keys(audioConsumers).length);
}
function getClientCount() {
    // WARN: undocumented method to get clients number
    return io.eio.clientsCount;
}

async function conenctPipes(producerPort) {
    if (pipeConnected){
        return;
    }
    console.log("--------- producer port", producerPort);
    try {

        await consumerPipeTransport.connect(
            {
                ip: "192.168.1.120",
                port: producerPort
            });

        consumerPipeTransport.observer.on('close', () => {
            console.log('==== pipeTransport1 closed ======');
            pipeTransport2.close();
        });
        pipeConnected = true;
    }
    catch (err) {
        console.error('pipeTransport ERROR:', err);
        if (consumerPipeTransport) {
            consumerPipeTransport.close();
            consumerPipeTransport = null;
        }
    }
}