var torrentStream = require('torrent-stream')
var readTorrent = require('read-torrent')
var http = require('http')
var rangeParser = require('range-parser')
var url = require('url')
var mime = require('mime')
var pump = require('pump')
var fs = require('fs')

var prepareEngine = function (engine, streams, request, response) {
    engine.on('ready', function () {
        for (var i = 0; i < streams.length; i++) {
            if (streams[i].infoHash == engine.infoHash) {
                engine.remove(function () {
                    engine.destroy(function(){})
                    playlistResponse(request, response, streams[i])
                })
                return
            }
        }
        console.log('\n' + engine.torrent.name)
        console.log(engine.files.map(function (file) {
            return file.name
        }))
        engine.idx = streams.length
        streams[engine.idx] = engine
        playlistResponse(request, response, engine)
    })
}

var addTorrentStream = function (torrent, streams, request, response) {
    if (/^magnet:/.test(torrent)) {
        var engine = torrentStream(torrent)
        prepareEngine(engine, streams, request, response)
    } else {
        readTorrent(torrent, function (err, torr, raw) {
            if (err) {
                console.error(err.message)
                process.exit(1)
            }
            var engine = torrentStream(raw)
            prepareEngine(engine, streams, request, response)
        })
    }
}

var playlistResponse = function (request, response, torrentStream) {

    var toEntry = function (file, i) {
        var entry = '#EXTINF:-1,' + file.name + '\n'
        entry += 'http://' + request.headers.host + '/' + torrentStream.idx + '/' + i
        return entry
    }

    var playlist = '#EXTM3U\n' + torrentStream.files.map(toEntry).join('\n')
    response.setHeader('Content-Disposition', 'attachment; filename="'+torrentStream.torrent.name+'.m3u')
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
        else if (u.pathname == '/delete_torrents') {
            this.torrentStreams.forEach(function (stream) {
                stream.remove(function () {
                    stream.destroy(function(){})
                })
                console.log('\nRemoved: ' + stream.torrent.name)
            })
            this.torrentStreams = []
            var info = JSON.stringify('done')
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Content-Length', Buffer.byteLength(info))
            return response.end(info)
        }
        else if (u.pathname == '/status') {
            var status = []
            this.torrentStreams.forEach(function (stream) {
                status.push({
                    name: stream.torrent.name,
                    files: stream.files.map(function (file) {
                        return file.name
                    })
                })
            })
            status = JSON.stringify(status, null, '    ')
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Content-Length', Buffer.byteLength(status))
            return response.end(status)
        }
        else if (u.pathname == '/') {
            fs.readFile('./html/index.html', function(err, html) {
                if (err) {
                    throw err
                }
                response.setHeader('Content-Type', 'text/html; charset=utf-8')
                response.setHeader('Content-Length', Buffer.byteLength(html))
                response.end(html)
            })
            return
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
