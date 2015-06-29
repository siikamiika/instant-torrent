#!/usr/bin/env node

var instantTorrent = require('./')

process.title = 'instant-torrent'

var server = instantTorrent()
server.listen(8888)
server.on('listening', function () {
    console.log('running')
})
