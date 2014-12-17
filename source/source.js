goog.provide('example');

goog.require('goog.dom');
goog.require('example.templates');

function domLoaded(callback) {
	// TODO: ask on StackOverflow
	// TODO: prevent Closure of clearing this out
    /* Internet Explorer */
    /*@cc_on
    @if (@_win32 || @_win64)
        document.write('<script id="ieScriptLoad" defer src="//:"><\/script>');
        document.getElementById('ieScriptLoad').onreadystatechange = function() {
            if (this.readyState == 'complete') {
                callback();
            }
        };
		return;
    @end @*/
    if (document.addEventListener) {
		/* Mozilla, Chrome, Opera */
        document.addEventListener('DOMContentLoaded', callback, false);
    } else if (/KHTML|WebKit|iCab/i.test(navigator.userAgent)) {
		/* Safari, iCab, Konqueror */
        var DOMLoadTimer = setInterval(function () {
            if (/loaded|complete/i.test(document.readyState)) {
                callback();
                clearInterval(DOMLoadTimer);
            }
        }, 10);
    } else {
		/* Other web browsers */
		window.onload = callback;
	}
};

domLoaded(function() {
	var newHeader = goog.dom.createDom('h1', goog.getCssName('myClass'), 'Hello world!');
	goog.dom.appendChild(document.body, newHeader);
	newHeader.innerHTML += example.templates.welcome({greeting: 'LOLWOW', year: new Date().getFullYear()});
});