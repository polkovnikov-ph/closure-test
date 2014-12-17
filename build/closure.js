var fs      = require('fs');
var stdout  = process.stdout;
var path    = require('path');
var vinyl   = require('vinyl');
var async   = require('async');
var dir     = require('node-dir');
var gutil   = require('gulp-util');
var buffer  = require('gulp-buffer');
var _       = require('lodash-node');
var es      = require('event-stream');
var extend  = require('util').inherits;
var sync    = require('temp-write').sync;
var trans   = require('stream').Transform;
var deps    = require('./closure-deps.js');
var spawn   = require('child_process').spawn;

// name of this gulp plugin
const PLUGIN_NAME =
	"gulp-closure-tools";
// path to closure stylesheets executable
const PATH_STYLESHEETS =
	'./3p/stylesheets/closure-stylesheets-20111230.jar';
// path to closure templates executable
const PATH_TEMPLATES =
	'./3p/templates/SoyToJsSrcCompiler.jar';
// path to closure compiler executable
const PATH_COMPILER =
	'./3p/compiler/compiler.jar';
// paths to roots of closure library
const PATH_LIBRARY_DIRS = [
	'./build/3p/library/closure/goog',
	'./build/3p/library/third_party',
	'./build/3p/templates'
];

// name of temporary file with compiled templates
const TEMP_COMPILED_SOY =
	'compiled_soy.js';
// name of temporary file with css renaming map
const TEMP_CSS_RENAMING_MAP =
	'css_renaming_map.js';
// name of temporary flag file to shorten command lines
const TEMP_FLAG_FILE =
	'flagFile.txt';

// throw gulp error
// TODO: buggy on Windows
function error(text) {
	return new gutil.PluginError(PLUGIN_NAME, text);
}

// transform stream into a buffer
function bufferize(stream, callback) {
	// array of parts of the file
	var chunks = [];
	// function that is called while stream is readable
	function onreadable() {
		// a part of file
		var chunk;
		// while there are parts, read them
		while (null !== (chunk = stream.read()))
			// and store in an array
			chunks.push(chunk);
	};
	// when stream is readable, read it
	stream.on('readable', onreadable);
	// when the stream got unreadable
	stream.once('end', function() {
		// stop trying to read it
		stream.removeListener('readable', onreadable);
		// return concatenated file
		callback(null, Buffer.concat(chunks));
	});
}

// save vinyl file to disk
function saveToDisk(vinylFile) {
	if (vinylFile.isNull()) {
		throw error("TODO: I don't know what to do with null files");
	} else if (vinylFile.isStream()) {
		throw error("TODO: I don't know how to work with streams");
	} else if (vinylFile.isBuffer()) {
		return sync(vinylFile.contents, path.basename(vinylFile.path));
	} else {
		throw error("What else?");
	}
}

// call java with given flags
function callJava(jarFile, flags, useFlagFile) {
	// tiered compilation makes java load faster
	var realFlags = ['-XX:+TieredCompilation', '-jar', jarFile];
	// use flag file?
	if (useFlagFile) {
		// generate temporary flag file
		var flagFilePath = sync(_.flatten(flags).join(' '), TEMP_FLAG_FILE);
		// flag file is used to shorten command line
		realFlags.push('--flagfile=' + flagFilePath);
	} else {
		// just add flags as is
		realFlags = realFlags.concat(flags);
	}
	return spawn('java', realFlags, {cwd: __dirname});
}

// create vinyl file
function makeVinyl(name, contents) {
	return new vinyl({
		// TODO: WTF? Virtual source of this file?
		path: "./" + name,
		// contents of the virtual file
		contents: contents
	});
}

// check whether file has certain extension
function hasExtension(ext, file) {
	return path.extname(file).replace('.', '') == ext;
}

// curry a function of two arguments
function curry2(f) {
	return function (a) { return function (b) { return f(a, b); }; };
}

// gulp closure stream constructor
function closure(options) {
	// allow calling it without `new`
	if (!(this instanceof closure)) return new closure(options);
	// if options were not passed, create them
	options = options || {};
	// show that this stream is using object mode
	options.objectMode = true;
	// call constructor of parent class
	trans.call(this, options);
	// if output file names were not set, use defaults
	if (!options.jsResult) options.jsResult = 'index.js';
	if (!options.cssResult) options.cssResult = 'index.css';
	// save options for further use
	this._options = options;
	// create an empty list to store Vinyl files
	this._files = [];
}
// closure class extends transformer streams
extend(closure, trans);

// when we've got new file on input
closure.prototype._transform = function(file, encoding, done) {
	// store it
	this._files.push(file);
	// callback
	done();
};

// when we're out of files on input
closure.prototype._flush = function (done) {
	// make this finally public
	var self = this;
	// associative array of arrays of temporary file names
	var saved = {soy: [], gss: [], js: []};
	// array of absolute file paths (set in vinyl) of js sources
	var jsSources = [];
	// for each stored file on stream's input
	_.each(this._files, function (file) {
		// get its extension
		var extension = path.extname(file.path).replace('.', '');
		// if extension in unknown
		if (!(extension in saved))
			done(error("Extension `" + extension + "` not allowed."));
		// store temporary file, remember its name
		saved[extension].push(saveToDisk(file));
		// for each javascript source code
		if (extension == 'js')
			// store absolute file paths for js sources
			jsSources.push(path.resolve(file.path));
	});
	
	// compile closure template
	function compileSoy(callback) {
		// create temporary file
		// we need this, as named pipes are not cross-platform
		var compiledSoyPath = sync('', TEMP_COMPILED_SOY);
		// pass flags
		var flags = [
			// file to write resulting JS into
			'--outputPathFormat', compiledSoyPath,
			// we need provide/require
			'--shouldProvideRequireSoyNamespaces',
			// list of soy files
			saved.soy
		];
		// spawn java child process
		var java = callJava(PATH_TEMPLATES, flags);
		// pass stdout and stderr streams of java into stdout of our process
		// so that we can see template compilation errors now
		java.stdout.pipe(stdout);
		java.stderr.pipe(stdout);
		// when templates have got compiled
		java.on('close', function () {
			// convert stream into buffer
			bufferize(fs.createReadStream(compiledSoyPath), function (err, buffer) {
				// return vinyl file with compiled soy javascript
				callback(null, makeVinyl(TEMP_COMPILED_SOY, buffer));
			});
		});
	}

	// compiler closure stylesheet
	function compileGss(callback) {
		// create temporary file
		// we need this, as named pipes are not cross-platform
		var cssRenamingMapJsPath = sync('', TEMP_CSS_RENAMING_MAP);
		// compiler flags
		var flags = [
			// renaming map is going to be used with closure compiler 
			'--output-renaming-map-format', 'CLOSURE_COMPILED',
			// renaming to the minimal possible number of characters
			'--rename', 'CLOSURE',
			// put renaming map into this temporary file
			'--output-renaming-map', cssRenamingMapJsPath,
			// a list of sources
			saved.gss
		];
		// spawn java child process
		var java = callJava(PATH_STYLESHEETS, flags);
		// pass stderr streams of java into stdout of our process
		// so that we can see stylesheet compilation errors now
		java.stderr.pipe(stdout);
		// put css file on output of the whole closure stream
		self.push(makeVinyl(self._options.cssResult, java.stdout));
		// when stylesheets have got compiled
		java.on('close', function () {
			// convert stream into buffer
			bufferize(fs.createReadStream(cssRenamingMapJsPath), function (err, buffer) {
				// return vinyl file with renaming map javascript
				callback(null, makeVinyl(TEMP_CSS_RENAMING_MAP, buffer));
			});
		});
	}
	
	// list all available sources
	function listAllSources(callback) {
		// roots of user library trees
		var roots = self._options.roots || [];
		// add roots of closure library
		roots = roots.concat(PATH_LIBRARY_DIRS)
		// and convert into absolute paths
		roots = roots.map(function (root) { return path.resolve(root); });
		
		// simultaneously recursively list contents of all root directories
		async.parallel(roots.map(curry2(dir.files)), function (err, sourceMatrix) {
			// if there was an error, throw it further
			if (err) return callback(err);
			// concatenate separate lists of file names from different roots
			var sourceList = _.flatten(sourceMatrix, true);
			// in case one root is inside another
			sourceList = _.uniq(sourceList);
			// in case some source files are inside roots
			sourceList = _.difference(sourceList, jsSources);
			// delete all non-js files
			sourceList = _.filter(sourceList, curry2(hasExtension)('js'));
			// add source file paths (for temporary files) into the mix 
			sourceList = sourceList.concat(saved.js);
			// return it
			callback(null, sourceList);
		});
	}
	
	// build an associative array (filenames => {provide: [], require: []})
	function buildSources(sourceFiles, callback) {
		// associative array to fill
		var sources = {}, googBase;
		// in parallel over all source files
		async.each(sourceFiles, function (filename, callback) {
			// read file into `contents`
			fs.readFile(filename, function (err, contents) {
				// if there was an error, throw it further
				if (err) return callback(err);
				try {
					// parse file
					var ret = deps.parse(contents.toString());
				} catch (err) {
					// if there was a parse error, throw it further
					return callback(err);
				}
				// if there's a @provideGoog JSDoc
				if (ret.provideGoog) {
					// we're implicitly providing `goog`
					ret.provide.goog = true;
					// remember this file as we have to include it
					googBase = filename;
				}
				// we don't need that flag anymore
				delete ret.provideGoog;
				// add provide/require data on this file to the list
				sources[filename] = ret;
				// we're done with this file
				callback();
			});
		// this callback is called when all the files are parsed or there was an error
		}, function (err) {
			// if there was an error with any file on the list, throw it further
			if (err) return callback(err);
			// otherwise, return an associative array of provide/require data
			callback(null, sources, googBase);
		});
	}
	
	// check if every requirement have been provided:
	function checkRequires(provides, sources, callback) {
		// for each source's provide/require data
		_.each(sources, function (source, filename) {
			// for each requirement of this particular source
			_.each(source.require, function (alwaysTrue, namespace) {
				// if namespace haven't been provided
				if (!(namespace in provides))
					// fail
					callback(error("No definitions of `" + namespace + "` for\n" + filename));
			});
		});
	}
	
	// create an associative array (namespace => who provides)
	function buildProvides(sources, callback) {
		// associative array to fill
		var provides = {};
		// for each source's provide/require data
		_.each(sources, function (data, filename) {
			// for each provided namespace
			_.each(data.provide, function (alwaysTrue, namespace) {
				// if namespace have already been provided
				if (namespace in provides)
					// fail
					callback(error("Multiple definitions for `" + namespace + "` in \n"
						+ provides[namespace] + '\nand\n' + filename));
				// `namespace` have been provided by `filename`
				provides[namespace] = filename;
			});
		});
		// check if every requirement have been provided:
		checkRequires(provides, sources, callback);
		// we've successfully checked provides/requires and build a reverse search data structure
		callback(null, provides);
	}
	
	// load dependency tree for further use
	function loadDepTree(callback) {
		// this time I regret there's no monad transformers
		// we're in a mix of Error and Cont monads in Haskell terms
		listAllSources(function (err, sourceFiles) {
			if (err) return callback(err);
			buildSources(sourceFiles, function (err, sources, googBase) {
				if (err) return callback(err);
				buildProvides(sources, function (err, provides) {
					if (err) return callback(err);
					callback(null, sources, googBase, provides);
				});
			});
		});
	}
	
	// resolve dependencies for a given namespace
	// uses depth-first search strategy
	function resolveDeps(data) {
		// we shouldn't pass all the data structures around while recurring
		// so we need this inner function. `alwaysTrue` is needed, because _.each
		// puts `value` into first argument of callback. `ns` is a namespace
		// we're currently resolving
		return function resolveDepsInner(alwaysTrue, ns) {
			// if new namespace haven't been provided, fail
			// should never happen, because we've already checked it beforehand
			if (!(ns in data.provides))
				throw error("No definitions of `" + ns + "`\nwhile resolving dependencies");
			// if namespace is already in our traversal path, the graph of 
			// dependencies has a cycle
			if (ns in data.traversalPath) {
				// add it so that users could clearly see the cycle
				data.traversalPath.push(ns);
				// fail
				throw error("Circular dependency detected:\n" + data.traversalPath.join("\n"));
			}
			// get the name of source file defining our current namespace
			var source = data.provides[ns];
			// if this source file have already been used, don't
			// traverse its dependencies again
			if (source in data.depsList) return;
			// save the namespace in a traversal path for a while
			data.traversalPath[ns] = true;
			// for each `require` of our current source, resolve its dependencies
			_.each(data.sources[source].require, resolveDepsInner);
			// delete a namespace from traversal path
			delete data.traversalPath[ns];
			// this source is certainly in our dependency list
			data.depsList[source] = true;
		};
	}
	
	// fix paths in source map
	function fixSourceMap(sourceMap, callback) {
		// as every source map is JSON, parse it accordingly
		var map = JSON.parse(sourceMap.toString());
		// get target directory (we need this to set right paths)
		var targetDir = path.resolve(self._options.sourceMapDir);
		// translate paths
		map.sources = map.sources.map(function (source) {
			// making paths relative to targetDir
			return path.relative(targetDir, source);
		});
		// convert back to string
		sourceMap = JSON.stringify(map, null, 0);
		// convert back to buffer object and return
		callback(new Buffer(sourceMap));
	}
	
	// compile javascript sources
	function compileJs(js, callback) {
		// variable to store the vinyl object for source map
		var sourceMapPath;
		// if we need a source map
		if (self._options.sourceMap)
			// create placeholder file
			sourceMapPath = sync('', path.basename(self._options.sourceMap));
		// compiler flags
		var flags = [
			// compilation level
			// TODO: `options.debug`-dependent
			'--compilation_level=ADVANCED_OPTIMIZATIONS',
			'--define', 'goog.DEBUG=false'
		];
		// if we need a source map
		if (self._options.sourceMap)
			// point compiler to the temporary file with source map
			flags.push('--create_source_map=' + sourceMapPath);
		// add javascript source files
		flags = flags.concat(_.map(js, function (x) { return '--js=' + x; }));
		// add any additional flags
		if (self._options.compilerFlags)
			flags = flags.concat(self._options.compilerFlags);
		// spawn java child process
		var java = callJava(PATH_COMPILER, flags);
		// pass stderr streams of java into stdout of our process
		// so that we can see javascript compilation errors now
		java.stderr.pipe(stdout);
		// if we don't need a source map
		if (!self._options.sourceMap) {
			// put css file on output of the whole closure stream
			self.push(makeVinyl(self._options.jsResult, java.stdout));
			// exit gulp-closure
			return done();
		} else {
			// cast to buffer js output
			bufferize(java.stdout, function (err, source) {
				if (err) return done(err);
				// when child thread exits
				java.on('close', function () {
					// cast to buffer source map
					bufferize(fs.createReadStream(sourceMapPath), function (err, sourceMapPre) {
						if (err) return done(err);
						// fix paths in source map
						fixSourceMap(sourceMapPre, function (sourceMap) {
							// return vinyl file with renaming map javascript
							self.push(makeVinyl(self._options.sourceMap, sourceMap));
							// append source map comment
							var appended = Buffer.concat([source, new Buffer(
								// TODO: check if it's done correctly
								"\n//# sourceMappingURL=" + self._options.sourceMap
							)]);
							// return vinyl file with renaming map javascript
							self.push(makeVinyl(self._options.jsResult, appended));
							// exit gulp-closure
							done();
						});
					});
				});
			});
		}
	}
	
	// wait until GSS and SOY get compiled
	async.parallel([compileSoy, compileGss], function (err, data) {
		// if there was an error, throw it further
		if (err) throw err;
		// list of files to be compiled anyway
		var mustCompile = self._options.mustCompile || [];
		// data contains an array of two JS sources, made with SOY and GSS
		// compilers corresondingly
		// the first one we would like to use as plain JS source
		saved.js.push(saveToDisk(data[0]));
		// second one doesn't have any `provide`s, so we have to add it manually
		mustCompile.push(saveToDisk(data[1]));
		// load data structures for dependency management
		loadDepTree(function (err, sources, googBase, provides) {
			if (err) throw err;
			// create traversal data object
			var traversalData = {
				sources: sources, provides: provides,
				// list of dependencies of our project
				depsList: {},
				// path taken by tree traversal
				traversalPath: {}
			};
			// for each main source file
			_.each(saved.js, function (tempfile) {
				// for each of its `provide`s
				_.each(_.keys(sources[tempfile].provide), function (namespace) {
					// find all files that are required for this source to
					// `provide` whatever it wants to
					resolveDeps(traversalData)(true, namespace);
				});
			});
			// we need only the keys (file names), 'cause previously we've used
			// an associative array to speed things up
			var dependencies = _.keys(traversalData.depsList);
			// add all the files that must be included anyway
			dependencies = dependencies.concat(mustCompile);
			// add one special file to be included first
			dependencies.unshift(googBase);
			// compile js sources
			compileJs(dependencies, done);
		});
	});
};

module.exports = closure;