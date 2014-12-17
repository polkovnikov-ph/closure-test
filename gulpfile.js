var gulp = require('gulp');
var es   = require('event-stream');

function build(debug) {
	var closure = require('./build/closure.js');
	var ret = es.merge(
		gulp
			.src([
				'source/*.js',
				'source/*.soy',
				'source/*.gss'
			])
			.pipe(closure({
				jsResult: 'target.js',
				cssResult: 'target.css',
				sourceMap: 'target.js.map',
				sourceMapDir: './target',
				debug: debug,
				// roots: [...]
				// mustCompile: [...]
				// cacheDeps: true
				// compilerFlags
			}))
			.pipe(gulp.dest('target')),		
		gulp
			.src('source/index.htm')
			.pipe(gulp.dest('target'))
	);
	ret.on('end', function () {
		console.log('stream ended');
	});
}

gulp.task('install', function () {
	// TODO: download documentation for closure etc
	var download = require('download');
	// https://code.google.com/p/closure-stylesheets/
	// https://code.google.com/p/closure-templates/
	// https://github.com/google/closure-compiler
	// https://code.google.com/p/closure-library/
	var files = [
		['https://closure-stylesheets.googlecode.com/files/closure-stylesheets-20111230.jar', 'stylesheets'],
		['https://closure-templates.googlecode.com/files/closure-templates-for-javascript-latest.zip', 'templates', true],
		['https://dl.google.com/closure-compiler/compiler-latest.zip', 'compiler', true],
		['https://closure-library.googlecode.com/files/closure-library-20130212-95c19e7f0f5f.zip', 'library', true]
	];
	files.forEach(function (file) {
		download(file[0], 'build/3p/' + file[1], {extract: !!file[2]});
	});
});

gulp.task('checkenv', function () {
	// TODO: check whether environment is OK (everything is installed)
});

gulp.task('grammar', function () {
	var peg = require('gulp-peg'); // 
	gulp.src('build/closure-deps.pegjs')
		.pipe(peg({optimize: "speed"}))
		.pipe(gulp.dest('build'));
});

gulp.task('docs', function () {
	// TODO: generate Swagger/JSDoc documentation
});

gulp.task('build', function () {
	build(false);
});

gulp.task('watch', function () {
	build(true);
	// TODO
	// run debugger
});

gulp.task('test', function () {
	// check correctness of package.json, all dependencies are required
	// run tests
	// calculate code coverage
});