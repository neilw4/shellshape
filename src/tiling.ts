/// <reference path="common.ts" />
/// <reference path="logging.ts" />

/* tslint:enable:typedef */

function noop() { };

module Tiling {
	// external symbols (may or may not exist in a given env)
	export var BORDER_RESIZE_INCREMENT = 0.05;
	export var WINDOW_ONLY_RESIZE_INCREMENT = BORDER_RESIZE_INCREMENT * 2;

	export interface Window {
		// implemented by mutter_window
		id():number
		tile_preference: any
		is_active():boolean
		activate():void
		is_minimized():boolean
		minimize():void
		unminimize():void
		maximize():void
		activate_before_redraw(reason:string):void
		move_to_workspace(new_index):void
		move_resize(r:Rect):void
		set_tile_preference(new_pref:boolean):void
		get_title():string
		rect():Rect
	}

	export interface Bounds extends Rect {
		update(newMonitor?):void
	}

	interface IndexedTiledWindow {
		item: WindowTile.BaseTiledWindow
		index: number
		toString(): String
	}

	export var Axis = {
		other: function(axis) {
			if (axis === 'y') {
				return 'x';
			} else {
				return 'y';
			}
		}
	};

	export var j = function(s) {
		return JSON.stringify(s);
	};

	var HALF = 0.5;

	export var STOP = '_stop_iter';

	export var ArrayUtil = {
		divide_after: function<T>(num, items: T[]): [T[], T[]] {
			return [items.slice(0, num), items.slice(num)];
		},

		moveItem: function(array, start, end) {
			var removed;
			removed = array.splice(start, 1)[0];
			array.splice(end, 0, removed);
			return array;
		},

		zip: function<T, U>(as: T[], bs: U[]): [T, U][] {
			let cs = []
			for (let i = 0; i < as.length && i < bs.length; i++) {
				cs.push([as[i], bs[i]])
			}
			return cs
		}
	};

	export var get_mouse_position = function():Point2d {
		throw "override get_mouse_position()";
	};

	export class Tile {
		static log = Logging.getLogger('shellshape.tiling.Tile');
		static copy_rect(rect:Rect) : Rect {
			return {
				pos: {
					x: rect.pos.x,
					y: rect.pos.y
				},
				size: {
					x: rect.size.x,
					y: rect.size.y
				}
			};
		}

		static split_rect(rect:Rect, axis:string, padding:number, partitions: number, ratio: number=0.5): Rect[] {
			var new_rect, new_size_a, new_size_b;
			// this.log.debug("#split_rect: splitting rect of " + j(rect) + " along the " + axis + " axis with ratio " + ratio);
			if (ratio > 1 || ratio < 0) {
				throw "invalid ratio: " + ratio + " (must be between 0 and 1)";
			}
			if (partitions == 0) {
				return []
			}
			if (partitions == 1) {
				return [rect]
			}

			let rects = [] as Rect[]
			// This is the complex part: `ratio` is the ratio of the first partition to the first + second partition
			// (for histerical reasons). So if we have more than 2 partitions we need to apply a scaling factor.
			let size_left_two = (rect.size[axis] * 2) / partitions
			let size_leftmost = Math.round(size_left_two * ratio)
			let size_others = Math.round(size_left_two) - size_leftmost
			padding = Math.round(Math.min(size_leftmost / 2, size_others / 2, padding))

			{
				new_rect = Tile.copy_rect(rect)
				new_rect.size[axis] = size_leftmost - padding
				rects.push(new_rect)
			}

			for (let i = 0; i < partitions - 1; i++) {
				new_rect = Tile.copy_rect(rect)
				new_rect.size[axis] = size_others - padding
				new_rect.pos[axis] += size_leftmost + i * size_others + padding
				rects.push(new_rect)
			}
			return rects
		}

		static add_diff_to_rect(rect:Rect, diff:Rect) {
			return {
				pos: Tile.point_add(rect.pos, diff.pos),
				size: Tile.point_add(rect.size, diff.size)
			};
		}

		static ensure_rect_exists(rect:Rect) {
			rect.size.x = Math.max(1, rect.size.x);
			rect.size.y = Math.max(1, rect.size.y);
			return rect;
		}

		static is_zero_rect(rect:Rect):boolean {
			return Tile.is_zero_point(rect.pos) && Tile.is_zero_point(rect.size);
		}

		static is_zero_point(point:Point2d):boolean {
			return point.x === 0 && point.y === 0;
		}

		static zero_rect(): Rect {
			return {
				pos: { x: 0, y: 0},
				size: { x: 0, y: 0 }
			};
		}

		static intersect(a:Rect, b:Rect):Rect {
			if (
				a.pos.x + a.size.x < b.pos.x ||  // b to right of a
				a.pos.y + a.size.y < b.pos.y ||  // b below a
				b.pos.x + b.size.x < a.pos.x ||  // a to right of b
				b.pos.y + b.size.y < a.pos.y     // a below b
			) return null;

			var xpos = Math.max(a.pos.x, b.pos.x);
			var ypos = Math.max(a.pos.y, b.pos.y);
			var w = Math.min(a.pos.x + a.size.x, b.pos.x + b.size.x) - xpos;
			var h = Math.min(a.pos.y + a.size.y, b.pos.y + b.size.y) - ypos;

			return {
				pos: { x: xpos, y: ypos },
				size: { x: w, y:h }
			}
		}

		static shrink(rect, border_px) {
			return {
				pos: {
					x: rect.pos.x + border_px,
					y: rect.pos.y + border_px
				},
				size: {
					x: Math.max(0, rect.size.x - (2 * border_px)),
					y: Math.max(0, rect.size.y - (2 * border_px))
				}
			};
		}

		static minmax(a:number, b:number):number[] {
			return [Math.min(a, b), Math.max(a, b)];
		}

		static midpoint(a:number, b:number):number {
			var max, min, _ref;
			_ref = this.minmax(a, b), min = _ref[0], max = _ref[1];
			return Math.round(min + ((max - min) / 2));
		}

		static within(val:number, a:number, b:number):boolean {
			var mm = this.minmax(a, b);
			var min = mm[0];
			var max = mm[1];
			// log("val #{val} within #{min},#{max}? #{val > min && val < max}")
			return val > min && val < max;
		}

		static move_rect_within(original_rect:Rect, bounds:Rect):Rect {
			// log("moving #{j original_rect} to be within #{j bounds}")
			var extent, max, min, rect;
			min = Math.min;
			max = Math.max;
			rect = Tile.copy_rect(original_rect);
			rect.size.x = min(rect.size.x, bounds.size.x);
			rect.size.y = min(rect.size.y, bounds.size.y);
			rect.pos.x = max(rect.pos.x, bounds.pos.x);
			rect.pos.y = max(rect.pos.y, bounds.pos.y);
			extent = function(rect, axis) {
				return rect.pos[axis] + rect.size[axis];
			};
			rect.pos.x -= max(0, extent(rect, 'x') - extent(bounds, 'x'));
			rect.pos.y -= max(0, extent(rect, 'y') - extent(bounds, 'y'));
			return {
				pos: this.point_diff(original_rect.pos, rect.pos),
				size: this.point_diff(original_rect.size, rect.size)
			};
		}
		
		static point_diff(a:Point2d, b:Point2d):Point2d {
			return {
				x: b.x - a.x,
				y: b.y - a.y
			};
		}
		
		static point_add(a:Point2d, b:Point2d):Point2d {
			return {
				x: a.x + b.x,
				y: a.y + b.y
			};
		}
		
		static rect_center(rect:Rect):Point2d {
			return {
				x: this.midpoint(rect.pos.x, rect.pos.x + rect.size.x),
				y: this.midpoint(rect.pos.y, rect.pos.y + rect.size.y)
			};
		}
		
		static point_is_within(point:Point2d, rect:Rect) {
			return this.within(point.x, rect.pos.x, rect.pos.x + rect.size.x) && this.within(point.y, rect.pos.y, rect.pos.y + rect.size.y);
		}

		static point_eq(a:Point2d, b:Point2d):boolean {
			return a.x === b.x && a.y === b.y;
		}

		static rect_eq(a:Rect, b:Rect):boolean {
			return (
				Tile.point_eq(a.pos, b.pos) &&
				Tile.point_eq(a.size, b.size)
			);
		}

		static joinRects(a:Rect, b:Rect):Rect {
			var pos, size, sx, sy;
			pos = {
				x: Math.min(a.pos.x, b.pos.x),
				y: Math.min(a.pos.y, b.pos.y)
			};
			sx = Math.max((a.pos.x + a.size.x) - pos.x, (b.pos.x + b.size.x) - pos.x);
			sy = Math.max((a.pos.y + a.size.y) - pos.y, (b.pos.y + b.size.y) - pos.y);
			size = {
				x: sx,
				y: sy
			};
			return {
				pos: pos,
				size: size
			};
		}
	}

	export interface HasId {
		id(): number
	}


	export class TileCollection {
		items:WindowTile.BaseTiledWindow[] = []
		log = Logging.getLogger("shellshape.tiling.TileCollection");
		bounds: Bounds;

		constructor(bounds: Bounds) {
			// provide ready-bound versions of any functions we need to use for filters:
			this.is_visible_and_untiled = Lang.bind(this, this._is_visible_and_untiled);
			this.is_tiled = Lang.bind(this, this._is_tiled);
			this.bounds = bounds;
		}

		is_visible = function(item: WindowTile.BaseTiledWindow) {
			return !item.is_minimized();
		}

		is_minimized = function(item: WindowTile.BaseTiledWindow) {
			return item.is_minimized();
		}

		is_visible_and_untiled:Predicate<WindowTile.BaseTiledWindow>
		private _is_visible_and_untiled(item: WindowTile.BaseTiledWindow) {
			return (!this.is_tiled(item)) && this.is_visible(item);
		}

		is_tiled:Predicate<WindowTile.BaseTiledWindow>
		private _is_tiled(item: WindowTile.BaseTiledWindow) {
			return item.managed && this.is_visible(item);
		}

		is_active = function(item: WindowTile.BaseTiledWindow) {
			return item.is_active();
		}

		num_tiled(): number {
			var len = 0;
			this.each_tiled(() => len += 1)
			return len;
		}

		protected sort_order(item: WindowTile.BaseTiledWindow, screen_midpoint: Point2d) {
			if (this.is_tiled(item)) {
				return 0;
			} else if (this.is_visible(item)) {
				return 1;
			} else {
				return 2;
			}
		}

		private sorted_with_indexes():IndexedTiledWindow[] {
			var self = this;
			var items_and_indexes:IndexedTiledWindow[] = [];
			var ts = function(this) {
				return "" + this.item + "@" + this.index;
			};

			for (var index=0; index < this.items.length; index++) {
				items_and_indexes.push({
					item: this.items[index],
					index: index,
					toString: ts
				});
			}
			var screen_midpoint = Tile.rect_center(this.bounds);
			var sorted = items_and_indexes.slice().sort(function(a, b) {
				var ordera, orderb;
				ordera = self.sort_order(a.item, screen_midpoint);
				orderb = self.sort_order(b.item, screen_midpoint);
				if (ordera === orderb) {
					// ensure a stable sort by using index position for equivalent windows
					return a.index - b.index;
				} else {
					return ordera - orderb;
				}
			});
			this.log.debug("sorted: " + items_and_indexes + " \n    to: " + sorted)
			return sorted;
		}

		private _wrap_index(idx, length) {
			while (idx < 0) {
				idx += length;
			}
			while (idx >= length) {
				idx -= length;
			}
			return idx;
		}

		filter<T>(f:Predicate<T>, items:T[]) {
			var rv = [];
			for (var i = 0; i < items.length; i++) {
				var item = items[i];
				if (f(item)) {
					rv.push(item);
				}
			}
			return rv;
		}

		select_cycle(diff: number):boolean {
			var cycled = this._with_active_and_neighbor_when_filtered(this.is_visible, diff, function(active, neighbor) {
				neighbor.item.activate();
			});
			if (!cycled) {
				// no active window - just select the first visible window if there is one
				var filtered = this.filter(this.is_visible, this.items);
				if (filtered.length > 0) {
					filtered[0].activate();
				}
			}
			return cycled;
		}

		private sorted_view(filter:Predicate<WindowTile.BaseTiledWindow>) {
			return this.filter<IndexedTiledWindow>(function(obj) {
				return filter(obj.item);
			}, this.sorted_with_indexes());
		}

		private _with_active_and_neighbor_when_filtered(
			filter:Predicate<WindowTile.BaseTiledWindow>,
			diff:number,
			cb:Function
		) {
			var self:TileCollection = this;
			var filtered = this.sorted_view(filter);
			var filtered_active_idx = this._index_where(filtered, function(obj) {
				return self.is_active(obj.item);
			});
			if (filtered_active_idx === null) {
				this.log.debug("active tile not found");
				return false;
			}
			var new_idx = this._wrap_index(filtered_active_idx + diff, filtered.length);
			this.log.debug("active tile found at index " + filtered_active_idx + ", neighbor idx = " + new_idx);
			cb(filtered[filtered_active_idx], filtered[new_idx]);
			return true;
		}

		most_recently_minimized(f:VoidFunc1<WindowTile.BaseTiledWindow>) {
			var filtered, sorted;
			filtered = this.filter(this.is_minimized, this.items);
			if (filtered.length > 0) {
				sorted = filtered.sort(function(a, b) {
					return b.minimized_order - a.minimized_order;
				});
				f(sorted[0]);
			}
		}

		cycle(diff: number) {
			// only one of these will have any effect, as the active tile is either tiled or untiled
			var self = this;
			var done = this._with_active_and_neighbor_when_filtered(this.is_tiled, diff, function(active, neighbor) {
				self.swap_at(active.index, neighbor.index);
			});
			if (!done) {
				self._with_active_and_neighbor_when_filtered(self.is_visible_and_untiled, diff, function(active, neighbor) {
					self.swap_at(active.index, neighbor.index);
				});
			}
		}

		_index_where<T>(elems:T[], cond:Predicate<T>) {
			for (var i = 0; i<elems.length; i++) {
				if (cond(elems[i])) {
					return i;
				}
			}
			return null;
		}

		_wrap_index_until(initial, offset, length, condition) {
			var index;
			index = initial;
			while (true) {
				index = this._wrap_index(index + offset, length);
				if (index === initial) {
					// break cycle in single-element list
					return initial;
				} else if (condition(index)) {
					return index;
				}
			}
		}

		swap_at(idx1, idx2) {
			// @log.debug("swapping items at index #{idx1} and #{idx2}")
			var w1 = this.items[idx1];
			var w2 = this.items[idx2];
			this.items[idx1] = w2;
			this.items[idx2] = w1;
			w1.swapped_with(w2);
		}

		contains(item:HasId) {
			return this.indexOf(item) !== -1;
		}

		indexOf(item:HasId) {
			var id, idx;
			id = item.id();
			idx = -1;
			this.each((tile, _idx) => {
				if (tile.id() === id) {
					this.log.debug("found id " + id);
					idx = _idx;
					return STOP;
				}
				return null;
			});
			return idx;
		}

		push(item):void {
			if (this.contains(item)) {
				return;
			}
			this.items.push(item);
		}

		each(f:IterFunc<WindowTile.BaseTiledWindow>):boolean {
			for (var i=0; i<this.items.length; i++) {
				var ret = f(this.items[i], i);
				if (ret === STOP) {
					return true;
				}
			}
			return false;
		}

		each_tiled(f:IterFunc<WindowTile.BaseTiledWindow>):void {
			this._filtered_each(this.is_tiled, f);
		}

		_filtered_each(filter:Predicate<WindowTile.BaseTiledWindow>, f:IterFunc<WindowTile.BaseTiledWindow>) {
			this.each(function(tile, idx) {
				if (filter(tile)) {
					f(tile, idx);
				}
			});
		}

		active(f:IterFunc<WindowTile.BaseTiledWindow>) {
			var self = this;
			this.each(function(item, idx) {
				if (self.is_active(item)) {
					f(item, idx);
					return STOP;
				}
				return null;
			});
		}

		for_layout(): WindowTile.BaseTiledWindow[] {
			// log.debug("tiles = #{@items}, filtered = #{@filter(@is_tiled, @items)}")
			return this.filter(this.is_tiled, this.items);
		}

		remove_at(idx) {
			return this.items.splice(idx, 1);
		}

		insert_at(idx, item:WindowTile.BaseTiledWindow) {
			return this.items.splice(idx, 0, item);
		}

		main(f:IterFunc<WindowTile.BaseTiledWindow>) {
			var self = this;
			self.each(function(tile, idx) {
				if (self.is_tiled(tile)) {
					f(tile, idx);
					return STOP;
				}
				return null;
			});
		}
	}

	export class FloatingTileCollection extends TileCollection {
		protected sort_order(item: WindowTile.BaseTiledWindow, screen_midpoint: Point2d) {
			if (!this.is_visible) {
				return 99999;
			}
			const window_midpoint = Tile.rect_center(item.desired_rect());
			const vector = Tile.point_diff(screen_midpoint, window_midpoint);
			const half_pi = Math.PI / 2;
			const tao = Math.PI * 2;

			var angle;
			if (Tile.is_zero_point(vector)) {
				angle = -half_pi;
			} else {
				// atan2 gives angles in the range -PI (pointing due left) through to +PI, anti-clockwise
				angle = Math.atan2(vector.y, vector.x);
			}


			// shift angles to all be negative, then negate them to make clockwise
			angle = (angle + Math.PI);

			// take a slice on the left, just below horizontal and shift it into negative
			// so that it's ordered first
			if (angle > ((31/32) * tao)) {
				angle -= tao;
			}

			this.log.debug("sort order for window " + item + ":")
			this.log.debug("sort order window rect = " + j(item.desired_rect()) + ", midpoint = " + j(window_midpoint));
			this.log.debug("sort order angle = " + angle + ", vector = " + j(vector));
			this.log.debug("sort order ...");

			return angle;
		}
	}

	export class BaseSplit {
		log = Logging.getLogger("shellshape.tiling.BaseSplit");
		ratio = HALF;
		axis: string;
		last_size: number;

		constructor(axis) {
			this.axis = axis;
		}
	
		adjust_ratio(diff:number):void {
			this.ratio = Math.min(1, Math.max(0, this.ratio + diff));
		}
	
		save_last_rect(rect:Rect):void {
			// log.debug("last_size changed from #{@last_size} -> #{rect.size[@axis]}")
			this.last_size = rect.size[this.axis];
		}
	
		adjust_ratio_px(diff:number) {
			var current_px, new_px, new_ratio;
			this.log.debug("adjusting ratio " + this.ratio + " by " + diff + " px");
			if (diff === 0) {
				return;
			}
			current_px = this.ratio * this.last_size;
			this.log.debug("current ratio makes for " + current_px + " px (assuming last size of " + this.last_size);
			new_px = current_px + diff;
			this.log.debug("but we want " + new_px);
			new_ratio = new_px / this.last_size;
			if (!Tile.within(new_ratio, 0, 1)) {
				throw "failed ratio: " + new_ratio;
			}
			this.log.debug("which makes a new ratio of " + new_ratio);
			this.ratio = new_ratio;
		}
	
	}

	export interface SplitStates {
		x: MultiSplit
		y: MultiSplit
	}
	
	export class MultiSplit extends BaseSplit {
		// a splitter that contains multiple windows on either side,
		// which is split along @axis (where 'x' is a split
		// that contains windows to the left and right)

		// number of leftmost windows. If 0, both the leftmost and second-left partition have 1 window. -ve values also supported. 
		primary_windows: number
		max_partitions: number
		log = Logging.getLogger("shellshape.tiling.MultiSplit")

		constructor(axis:string, primary_windows: number, max_partitions: number) {
			super(axis);
			this.primary_windows = primary_windows;
			this.max_partitions = max_partitions;
		}
	
		split(bounds: Bounds, windows: WindowTile.BaseTiledWindow[], padding: number): [Rect, WindowTile.BaseTiledWindow[]][] {
			var left_rect, left_windows, right_rect, right_windows;
			this.save_last_rect(bounds);

			let partitioned_windows = this.partition_windows(windows)
			let rects = Tile.split_rect(bounds, this.axis, padding, partitioned_windows.length, this.ratio)
			return ArrayUtil.zip(rects, partitioned_windows)
		}

		partition_windows(windows): WindowTile.BaseTiledWindow[][] {
			// Copy array in case we mess up state somewhere else
			let partitioned = [] as WindowTile.BaseTiledWindow[][]
			// note: misses out the rightmost partition
			for (let i = 0; i < this.max_partitions - 1 && windows.length > 0; i++) {
				// Increase number of windows per partition going from left to right
				let take = Math.max(1, this.primary_windows + i)
				var taken
				[taken, windows] = ArrayUtil.divide_after(take, windows)
				partitioned.push(taken)
			}
			// Everything remaining goes in the rightmost partition
			if (windows.length > 0) {
				partitioned.push(windows)
			}
			return partitioned
		}
	
		in_primary_partition(idx) {
			// @log.debug("on left? #{idx}, #{@primary_windows} == #{idx < @primary_windows}")
			// primary_windows can be negative
			return idx < this.primary_windows || idx == 0;
		}
	}
	
	export interface Point2d {
		x: number
		y: number
	}

	export interface Rect {
		pos: Point2d
		size: Point2d
	}
}

/// <reference path="window_tile.ts" />
/// <reference path="layout.ts" />
