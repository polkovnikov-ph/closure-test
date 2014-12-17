var Transform = require('stream').Transform;
function debug() {
	var options = {objectMode: true};
	if (!(this instanceof debug)) return new debug();
	Transform.call(this, options);
}
require('util').inherits(debug, Transform);
debug.prototype._transform = function(file, encoding, done) {
	console.log(file);
	done();
};
module.exports = debug;