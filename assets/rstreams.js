/* eslint-disable no-undef */
function init() {
	const el = document.getElementById('tsd-show-legend');
	const legendEl = document.getElementById('legend-countainer');
	
	el.addEventListener('change', function() {
		const hasShowClass = legendEl.classList.contains('show');
		let toggleIt = false;

		if (this.checked) {
			if (!hasShowClass) {toggleIt = true;}
			else {/* We're good, do nothing */}
		} else if (hasShowClass) {
			toggleIt = true;
		}

		if (toggleIt) {
			legendEl.classList.toggle('show');
		}
	});
}

init();
