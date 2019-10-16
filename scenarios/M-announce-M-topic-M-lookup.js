/* global ip */
'use strict'
const tapenet = require('tapenet')
const spinup = require('./helpers/spinup')

const {
  NODES = 101,
  RTS = 10
} = process.env

const topology = tapenet.topologies.basic(NODES)
const { h1: bootstrapper, ...rest } = topology
const nodes = spinup.arrarify(rest)
const announcers = nodes.slice(0, nodes.length / 2)
const lookups = nodes.slice(nodes.length / 2)

tapenet(`${lookups.length} lookup peers, ${announcers.length} announcing peers, ${announcers.length} topics, ${RTS} lookups per topic`, (t) => {
  const state = {
    rts: +RTS,
    announcerCount: announcers.length,
    $shared: {
      cfg: {},
      topics: {}
    }
  }
  const scenario = [
    {
      containers: announcers,
      options: { ephemeral: false },
      ready (t, peer, state, next) {
        const crypto = require('crypto')
        const topic = crypto.randomBytes(32)
        const { $shared, $index } = state
        const { port } = peer.address()
        $shared.cfg[$index] = { host: ip, port }
        $shared.topics[$index] = topic

        next(null, { ...state, topic })
      },
      run (t, peer, { topic }, done) {
        peer.announce(topic, (err) => {
          t.error(err, 'no announce error')
          done()
        })
      }
    },
    {
      containers: lookups,
      options: { ephemeral: false },
      ready (t, peer, state, next) {
        const { $shared, $index, announcerCount } = state
        const { port } = peer.address()
        $shared.cfg[$index + announcerCount] = { host: ip, port }
        next(null, state)
      },
      run (t, peer, { rts, $shared, bootstrap }, done) {
        const { cfg } = $shared
        const topics = Object.values($shared.topics)
        const started = Date.now()
        lookups(rts, 0)
        function lookups (n, i) {
          const topic = topics[i]
          if (n === 0) {
            t.pass(`${rts} round trips took ${Date.now() - started} ms`)
            if (i < topics.length - 1) {
              lookups(0, i + 1)
              return
            }
            done()
            return
          }
          peer.lookup(topic, (err, result) => {
            t.error(err, 'no lookup error')
            if (err) return
            const hasResult = result.length > 0
            t.is(hasResult, true, 'lookup has a result')
            if (hasResult === false) return
            const expected = new Set([
              ...bootstrap,
              ...Object.values(cfg).map(({ host, port }) => {
                return `${host}:${port}`
              })
            ])

            const peersMatch = result.every(({ node, peers }) => {
              const { host, port } = node
              return expected.has(`${host}:${port}`) && peers.every(({ host, port }) => {
                return expected.has(`${host}:${port}`)
              })
            })
            t.ok(peersMatch, 'peers match')
            lookups(n - 1, i)
          })
        }
      }
    }
  ]
  spinup(NODES, { t, scenario, state, bs: [bootstrapper] })
})
