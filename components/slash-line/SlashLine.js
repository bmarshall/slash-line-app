(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.SlashLine = factory());
}(this, (function () { 'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src/SlashLine.svelte generated by Svelte v3.29.0 */

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-sxbzuz-style";
    	style.textContent = ".above-average.svelte-sxbzuz{background-color:#DC143C;color:#ffffff}.below-average.svelte-sxbzuz{background-color:#0000FF;color:#ffffff}";
    	append(document.head, style);
    }

    // (27:0) {:else}
    function create_else_block(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("- -/-/-");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    // (20:0) {#if name}
    function create_if_block(ctx) {
    	let div;
    	let t0;
    	let t1;
    	let span0;
    	let t2_value = /*formatPercentage*/ ctx[9](/*avg*/ ctx[1]) + "";
    	let t2;
    	let span0_class_value;
    	let t3;
    	let span1;
    	let t4_value = /*formatPercentage*/ ctx[9](/*obp*/ ctx[2]) + "";
    	let t4;
    	let span1_class_value;
    	let t5;
    	let span2;
    	let t6_value = /*formatPercentage*/ ctx[9](/*slg*/ ctx[3]) + "";
    	let t6;
    	let span2_class_value;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div = element("div");
    			t0 = text(/*name*/ ctx[0]);
    			t1 = space();
    			span0 = element("span");
    			t2 = text(t2_value);
    			t3 = text(" /\n\t\t");
    			span1 = element("span");
    			t4 = text(t4_value);
    			t5 = text(" /\n\t\t");
    			span2 = element("span");
    			t6 = text(t6_value);
    			attr(span0, "class", span0_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseAvg*/ ctx[4], /*avg*/ ctx[1])) + " svelte-sxbzuz"));
    			attr(span1, "class", span1_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseObp*/ ctx[5], /*obp*/ ctx[2])) + " svelte-sxbzuz"));
    			attr(span2, "class", span2_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseSlg*/ ctx[6], /*slg*/ ctx[3])) + " svelte-sxbzuz"));
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, t0);
    			append(div, t1);
    			append(div, span0);
    			append(span0, t2);
    			append(div, t3);
    			append(div, span1);
    			append(span1, t4);
    			append(div, t5);
    			append(div, span2);
    			append(span2, t6);

    			if (!mounted) {
    				dispose = [
    					listen(span0, "click", function () {
    						if (is_function(/*toClickHandler*/ ctx[7]("avg"))) /*toClickHandler*/ ctx[7]("avg").apply(this, arguments);
    					}),
    					listen(span1, "click", function () {
    						if (is_function(/*toClickHandler*/ ctx[7]("obp"))) /*toClickHandler*/ ctx[7]("obp").apply(this, arguments);
    					}),
    					listen(span2, "click", function () {
    						if (is_function(/*toClickHandler*/ ctx[7]("slg"))) /*toClickHandler*/ ctx[7]("slg").apply(this, arguments);
    					})
    				];

    				mounted = true;
    			}
    		},
    		p(new_ctx, dirty) {
    			ctx = new_ctx;
    			if (dirty & /*name*/ 1) set_data(t0, /*name*/ ctx[0]);
    			if (dirty & /*avg*/ 2 && t2_value !== (t2_value = /*formatPercentage*/ ctx[9](/*avg*/ ctx[1]) + "")) set_data(t2, t2_value);

    			if (dirty & /*baseAvg, avg*/ 18 && span0_class_value !== (span0_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseAvg*/ ctx[4], /*avg*/ ctx[1])) + " svelte-sxbzuz"))) {
    				attr(span0, "class", span0_class_value);
    			}

    			if (dirty & /*obp*/ 4 && t4_value !== (t4_value = /*formatPercentage*/ ctx[9](/*obp*/ ctx[2]) + "")) set_data(t4, t4_value);

    			if (dirty & /*baseObp, obp*/ 36 && span1_class_value !== (span1_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseObp*/ ctx[5], /*obp*/ ctx[2])) + " svelte-sxbzuz"))) {
    				attr(span1, "class", span1_class_value);
    			}

    			if (dirty & /*slg*/ 8 && t6_value !== (t6_value = /*formatPercentage*/ ctx[9](/*slg*/ ctx[3]) + "")) set_data(t6, t6_value);

    			if (dirty & /*baseSlg, slg*/ 72 && span2_class_value !== (span2_class_value = "" + (null_to_empty(/*generateStatStyle*/ ctx[8](/*baseSlg*/ ctx[6], /*slg*/ ctx[3])) + " svelte-sxbzuz"))) {
    				attr(span2, "class", span2_class_value);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*name*/ ctx[0]) return create_if_block;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	const dispatch = createEventDispatcher();
    	let { baseSlashLine = {} } = $$props;
    	let { comparatorSlashLine = {} } = $$props;

    	const generateStatStyle = (baseValue, comparatorValue) => comparatorValue > baseValue
    	? "above-average "
    	: "below-average";

    	const formatPercentage = val => val.toFixed(3).substring(1);

    	$$self.$$set = $$props => {
    		if ("baseSlashLine" in $$props) $$invalidate(10, baseSlashLine = $$props.baseSlashLine);
    		if ("comparatorSlashLine" in $$props) $$invalidate(11, comparatorSlashLine = $$props.comparatorSlashLine);
    	};

    	let name;
    	let avg;
    	let obp;
    	let slg;
    	let baseAvg;
    	let baseObp;
    	let baseSlg;
    	let toClickHandler;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*comparatorSlashLine*/ 2048) {
    			 $$invalidate(0, { name, avg, obp, slg } = comparatorSlashLine, name, ($$invalidate(1, avg), $$invalidate(11, comparatorSlashLine)), ($$invalidate(2, obp), $$invalidate(11, comparatorSlashLine)), ($$invalidate(3, slg), $$invalidate(11, comparatorSlashLine)));
    		}

    		if ($$self.$$.dirty & /*baseSlashLine*/ 1024) {
    			 $$invalidate(4, { avg: baseAvg, obp: baseObp, slg: baseSlg } = baseSlashLine, baseAvg, ($$invalidate(5, baseObp), $$invalidate(10, baseSlashLine)), ($$invalidate(6, baseSlg), $$invalidate(10, baseSlashLine)));
    		}

    		if ($$self.$$.dirty & /*name, comparatorSlashLine, baseSlashLine*/ 3073) {
    			 $$invalidate(7, toClickHandler = prop => () => dispatch("statClicked", {
    				name,
    				stat: prop,
    				difference: comparatorSlashLine[prop] - baseSlashLine[prop]
    			}));
    		}
    	};

    	return [
    		name,
    		avg,
    		obp,
    		slg,
    		baseAvg,
    		baseObp,
    		baseSlg,
    		toClickHandler,
    		generateStatStyle,
    		formatPercentage,
    		baseSlashLine,
    		comparatorSlashLine
    	];
    }

    class SlashLine extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document.getElementById("svelte-sxbzuz-style")) add_css();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			baseSlashLine: 10,
    			comparatorSlashLine: 11
    		});
    	}
    }

    return SlashLine;

})));
