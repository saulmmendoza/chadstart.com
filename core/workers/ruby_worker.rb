#!/usr/bin/env ruby
# ChadStart Ruby runtime worker.
# Protocol: {"id": N, "entry": "/path/to/fn.rb", "event": {...}, "ctx": {...}}
require 'json'

$stdout.sync = true

$stdin.each_line do |line|
  line.strip!
  next if line.empty?
  begin
    req = JSON.parse(line)
    load req['entry']
    event = req['event'] || {}
    ctx   = req['ctx']   || {}
    result = defined?(handler) ? handler(event, ctx) : (defined?(default) ? method(:default).call(event, ctx) : nil)
    puts JSON.generate({ id: req['id'], result: result })
  rescue => e
    puts JSON.generate({ id: req['id'], error: e.message })
  end
end
