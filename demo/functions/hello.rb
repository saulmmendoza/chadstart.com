# hello.rb — ChadStart Ruby function
# Returns a greeting from the Ruby runtime.
#
# Runtime: ruby
# Trigger: GET /api/fn/greet/ruby (public)

def handler(event, ctx)
  name = ((event['query'] || {})['name'] || 'World')
  { 'message' => "Hello, #{name}!", 'runtime' => 'ruby' }
end
