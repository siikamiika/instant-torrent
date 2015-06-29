var torrentStream = require('torrent-stream')
var readTorrent = require('read-torrent')
var http = require('http')
var rangeParser = require('range-parser')
var url = require('url')
var mime = require('mime')
var pump = require('pump')

var prepareEngine = function (engine, torrent, streams, request, response) {
    engine.request = request
    engine.response = response
    engine.id = torrent
    engine.idx = streams.length
    engine.on('ready', function () {
        console.log('\n' + engine.id)
        engine.files.forEach(function (file) {
            console.log(file.name)
        })
        playlistResponse(engine.request, engine.response, engine)
    })
    engine.listen()
    streams[engine.idx] = engine
}

var addTorrentStream = function (torrent, streams, request, response) {
    var idExists = false
    streams.forEach(function (stream) {
        if (stream.id == torrent) {
            idExists = true
            return playlistResponse(request, response, stream)
        }
    })
    if (idExists) return

    if (/^magnet:/.test(torrent)) {
        var engine = torrentStream(torrent)
        prepareEngine(engine, torrent, streams, request, response)
    } else {
        readTorrent(torrent, function (err, torr, raw) {
            if (err) {
                console.error(err.message)
                process.exit(1)
            }
            var engine = torrentStream(raw)
            prepareEngine(engine, torrent, streams, request, response)
        })
    }
}

var playlistResponse = function (request, response, torrentStream) {

    var toEntry = function (file, i) {
        var entry = '#EXTINF:-1,' + file.path + '\n'
        entry += 'http://' + request.headers.host + '/' + torrentStream.idx + '/' + i
        return entry
    }

    var playlist = '#EXTM3U\n' + torrentStream.files.map(toEntry).join('\n')

    response.setHeader('Content-Type', 'application/x-mpegurl; charset=utf-8')
    response.setHeader('Content-Length', Buffer.byteLength(playlist))
    response.end(playlist)
}

var createServer = function (opts) {

    var server = http.createServer()

    server.torrentStreams = []

    server.on('request', function (request, response) {
        var u = url.parse(request.url)
        var host = 'localhost'

        if (u.pathname.indexOf('/stream_torrent/') === 0) {
            var torrent = u.path.slice('/stream_torrent/'.length)
            return addTorrentStream(decodeURIComponent(torrent), this.torrentStreams, request, response)
        }
        else if (u.pathname == '/status') {
            var status = []
            this.torrentStreams.forEach(function (stream) {
                status.push({id: stream.id, files: stream.files})
            })
            status = JSON.stringify(status, null, '    ')
            response.setHeader('Content-Type', 'text/plain; charset=utf-8')
            response.setHeader('Content-Length', Buffer.byteLength(status))
            return response.end(status)
        }
        // open file stream
        else {
            var streamPath = u.path.split('/').slice(1,3).map(function (s) {return parseInt(s)})
            if (isNaN(streamPath[0]) || streamPath[0] < 0 || streamPath[0] >= this.torrentStreams.length) {
                response.statusCode = 404
                console.log('invalid torrent index: ' + streamPath[0])
                return response.end()
            }
            var files = this.torrentStreams[streamPath[0]].files
            if (isNaN(streamPath[1] || streamPath[1] < 0 || streamPath[0] >= files.length)) {
                response.statusCode = 404
                console.log('invalid file index: ' + streamPath[1])
                return response.end()
            }
            // file found, send stream headers
            var file = files[streamPath[1]]
            var range = request.headers.range
            range = range && rangeParser(file.length, range)[0]
            response.setHeader('Accept-Ranges', 'bytes')
            response.setHeader('Content-Type', mime.lookup(file.name))
            if (!range) {
                response.setHeader('Content-Length', file.length)
                if (request.method === 'HEAD') return response.end()
                pump(file.createReadStream(), response)
                return
            }

            response.statusCode = 206
            response.setHeader('Content-Length', range.end - range.start + 1)
            response.setHeader('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + file.length)
            if (request.method === 'HEAD') return response.end()
            pump(file.createReadStream(range), response)
        }
    })

    server.on('connection', function (socket) {
        socket.setTimeout(36000000)
    })

    return server
}


module.exports = function (opts) {
    var server = createServer(opts)
    return server
}
