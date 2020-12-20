module.exports = {
    // Worker settings
    worker: {
        rtcMinPort: 10000,
        rtcMaxPort: 10100,
        logLevel: 'warn',
        logTags: [
            'info',
            'ice',
            'dtls',
            'rtp',
            'srtp',
            'rtcp',
            // 'rtx',
            // 'bwe',
            // 'score',
            // 'simulcast',
            // 'svc'
        ],
    },
    // Router settings
    router: {
        mediaCodecs:
            [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP8',
                    clockRate: 90000,
                    parameters:
                    {
                        'x-google-start-bitrate': 1000
                    }
                },
            ]
    },
    // WebRtcTransport settings
    webRtcTransport: {
        listenIps: [
            { ip: '192.168.1.120', announcedIp: null }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        maxIncomingBitrate: 1500000,
        initialAvailableOutgoingBitrate: 1000000,
    }
}