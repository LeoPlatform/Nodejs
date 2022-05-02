import { DefaultThemeRenderContext, PageEvent, Reflection, JSX, DeclarationReflection, SignatureReflection, RendererHooks } from 'typedoc';

function hasTypeParameters(reflection) {
	if (reflection instanceof DeclarationReflection || reflection instanceof SignatureReflection) {
		return reflection.typeParameters != null;
	}
	return false;
}

function join(joiner, list, cb) {
	const result = [];
	for (const item of list) {
		if (result.length > 0) {
			result.push(joiner);
		}
		result.push(cb(item));
	}
	return JSX.createElement(JSX.Fragment, null, result);
}

function renderFlags(flags) {
	return (JSX.createElement(JSX.Fragment, null, flags.map((item) => (JSX.createElement(JSX.Fragment, null,
		JSX.createElement("span", { class: "tsd-flag ts-flag" + item }, item),
		" ")))));
}

// export function onHeadRenderHook(context: RStreamsThemeContext) {
// 	return (
// 		JSX.createElement("link", { rel: "stylesheet", href: context.relativeURL("assets/rstreams.css") }),
// 		JSX.createElement("link", { rel: "icon", type: "image/x-icon", href: context.relativeURL("assets/favicon.png") })
// 	);
// }
// <script>
// 	<JSX.Raw html="alert('hi!');" />
// </script>);

let _rstreamsSiteUrl: string;
let _sdkName: string;
let _sdkNameForBreadcrumb: string;

export function init(rstreamsSiteUrl: string, sdkName: string, sdkNameForBreadcrumb: string) {
	_rstreamsSiteUrl = rstreamsSiteUrl;
	_sdkName = sdkName;
	_sdkNameForBreadcrumb = sdkNameForBreadcrumb;
}

export class RStreamsThemeContext extends DefaultThemeRenderContext {
	defaultLayout = (props: PageEvent<Reflection>) => {
		let _a;
		let hidePageHeaderForHomePage = false;
		if (props.model.name.indexOf(_sdkName) > -1) {
			hidePageHeaderForHomePage = true;
		}

		return (JSX.createElement("html", { class: "default" },
			JSX.createElement("head", null,
				JSX.createElement("meta", { charSet: "utf-8" }),
				this.hook("head.begin"),
				JSX.createElement("meta", { "http-equiv": "x-ua-compatible", content: "IE=edge" }),
				JSX.createElement("title", null, props.model.name === props.project.name
					? props.project.name
					: `${props.model.name} | ${props.project.name}`),
				JSX.createElement("meta", { name: "description", content: "Documentation for " + props.project.name }),
				JSX.createElement("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
				JSX.createElement("link", { rel: "stylesheet", href: this.relativeURL("assets/style.css") }),
				JSX.createElement("link", { rel: "stylesheet", href: this.relativeURL("assets/highlight.css") }),
				this.options.getValue("customCss") && (JSX.createElement("link", { rel: "stylesheet", href: this.relativeURL("assets/custom.css") })),
				JSX.createElement("script", { async: true, src: this.relativeURL("assets/search.js"), id: "search-script" }),

				// Added these
				JSX.createElement("link", { rel: "stylesheet", href: this.relativeURL("assets/rstreams.css") }),
				JSX.createElement("link", { rel: "icon", type: "image/x-icon", href: this.relativeURL("assets/favicon.png") }),


				this.hook("head.end")),
			JSX.createElement("body", null,
				this.hook("body.begin"),
				JSX.createElement("script", null,
					JSX.createElement(JSX.Raw, { html: 'document.body.classList.add(localStorage.getItem("tsd-theme") || "os")' })),
				this.header(props),
				JSX.createElement("div", { class: "container container-main" },
					JSX.createElement("div", { class: "row" },
						JSX.createElement("div", { class: "col-8 col-content" },

							// Moved from header
							(
								JSX.createElement("div", null,
									JSX.createElement("div", {class: "dflex mt-minus30"},
										!!props.model.parent && JSX.createElement("ul", { class: "tsd-breadcrumb fg1" }, this.breadcrumb(props.model)),
										JSX.createElement("div", { id: "tsd-widgets", class: "mr10", style: hidePageHeaderForHomePage ? 'display:none' : ''},
											JSX.createElement("input", { type: "checkbox", id: "tsd-filter-inherited", checked: true }),
											JSX.createElement("label", { class: "tsd-widget ws-nowrap dflex align-c ht17", for: "tsd-filter-inherited" }, "Inherited")),
										JSX.createElement("div", { id: "tsd-widgets2", class: "mr10", style: hidePageHeaderForHomePage ? 'display:none' : ''},
											JSX.createElement("input", { type: "checkbox", id: "tsd-show-legend", checked: false}),
											JSX.createElement("label", { class: "tsd-widget ws-nowrap dflex align-c ht17", for: "tsd-show-legend" }, "Legend"))),
									JSX.createElement("h1", {class: "mt0 header-color"},
										props.model.kindString !== "Project" && `${(_a = props.model.kindString) !== null && _a !== void 0 ? _a : ""} `,
										props.model.name,
										(hasTypeParameters)(props.model) && (JSX.createElement(JSX.Fragment, null,
											"<",
											(join)(", ", (props.model as DeclarationReflection).typeParameters, (item) => item.name),
											">")),
										" ",
										(renderFlags)(props.model.flags),
									)
								)
									
							),
							(
								(JSX.createElement(JSX.Fragment, null,
									JSX.createElement("div", {id: "legend-countainer"}, 
										JSX.createElement("h2", null, "Legend"),
										JSX.createElement("div", { class: "tsd-legend-group" }, props.legend.map((item) => (JSX.createElement("ul", { class: "tsd-legend" }, item.map((item) => (JSX.createElement("li", { class: item.classes.join(" ") },
											JSX.createElement("span", { class: "tsd-kind-icon" }, item.name)))))))))))
							),
							this.hook("content.begin"),
							props.template(props),
							this.hook("content.end")),
						JSX.createElement("div", { class: "col-4 col-menu menu-sticky-wrap menu-highlight" },
							this.hook("navigation.begin"),
							this.navigation(props),
							this.hook("navigation.end")))),
				this.footer(props),
				JSX.createElement("div", { class: "overlay" }),
				JSX.createElement("script", { src: this.relativeURL("assets/main.js") }),
				JSX.createElement("script", { src: this.relativeURL("assets/rstreams.js") }),
				this.analytics(),
				this.hook("body.end"))))};

	header = (props: PageEvent<Reflection>) => {
		var _a;
		return (
			<div class="toolbarcontainer container dflex align-c">
				{JSX.createElement("a", { href: this.relativeURL(_rstreamsSiteUrl), class: "title ml10" }, 
					JSX.createElement("img", { src: this.relativeURL("assets/rstreams-logo.png") }))}
				{JSX.createElement("div", {class: "dflex align-c fg1 flexcenter"},
					JSX.createElement("a", { href: this.relativeURL("index.html"), class: "title sitename header-color" }, "Node SDK"))}
				<div id="tsd-search" data-base="." class="mr10">
					<label for="tsd-search-field" style="display:none" class="tsd-widget search">Search</label>
					<div class="field"><input type="text" id="tsd-search-field" placeholder="Search here..." /></div>
					<ul class="results">
						<li class="state loading">Preparing search index...</li>
						<li class="state failure">The search index is not available</li>
					</ul>
				</div>
				{
					JSX.createElement("div", { id: "tsd-widgets", class: "mr10"},
						JSX.createElement("div", { id: "tsd-filter" },
							JSX.createElement("a", { href: "#", class: "tsd-widget menu no-caption", "data-toggle": "menu" }, "Menu"))
					)
				}
			</div>
		);
	};

	breadcrumb = (props: Reflection) => {
		let linkName = props.name;
		if (linkName.indexOf(_sdkName) > -1) {
			linkName = _sdkNameForBreadcrumb;
		}

		return props.parent ? (JSX.createElement(JSX.Fragment, null,
			this.breadcrumb(props.parent),
			JSX.createElement("li", null, props.url ? JSX.createElement("a", { href: this.urlTo(props) }, linkName) : JSX.createElement("span", null, linkName)))) : props.url ? (JSX.createElement("li", null,
			JSX.createElement("a", { href: this.urlTo(props) }, linkName))) : undefined;
	}
	
}
