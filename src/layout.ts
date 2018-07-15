/// <reference path="common.ts" />
/// <reference path="logging.ts" />
/// <reference path="tiling.ts" />
/// <reference path="window_tile.ts" />

/* tslint:enable:typedef */

module Layout {
	// bind useful utils from tiling
	var j = Tiling.j;
	var STOP = Tiling.STOP;
	var contains = function(arr, item) {
		return arr.indexOf(item) !== -1;
	};

	export class Default {
		static primary_windows: number = 1
		static num_partitions: number = 2
	}

	export class LayoutState {
		// shared state for every layout type. Includes distinct @splits
		// objects for both directions
		splits: Tiling.SplitStates
		bounds: Tiling.Bounds
		static padding = 0;

		constructor(bounds:Tiling.Bounds) {
			this.bounds = assert(bounds);
			this.splits = {
				'x': new Tiling.MultiSplit('x', Default.primary_windows, Default.num_partitions),
				'y': new Tiling.MultiSplit('y', Default.primary_windows, Default.num_partitions),
			};
		}
	
		empty_copy() {
			return new LayoutState(this.bounds);
		}
	}

	export abstract class BaseLayout {
		state: LayoutState
		bounds: Tiling.Bounds
		tiles: Tiling.TileCollection
		log: Logger

		protected abstract create_tile(win: Tiling.Window, state: LayoutState): WindowTile.BaseTiledWindow;
	
		constructor(name, state:LayoutState) {
			this.log = Logging.getLogger("shellshape.tiling." + name);
			this.state = assert(state);
			this.bounds = state.bounds;
			this.tiles = new Tiling.TileCollection(this.bounds);
		}
	
		toString() {
			return "[object BaseLayout]";
		}

		abstract layout():void;
	
		each(func:IterFunc<WindowTile.BaseTiledWindow>) {
			return this.tiles.each(func);
		}

		each_tiled(func:IterFunc<WindowTile.BaseTiledWindow>) {
			return this.tiles.each_tiled(func);
		}
	
		contains(win:Tiling.HasId) {
			return this.tiles.contains(win);
		}
	
		tile_for(win:Tiling.Window, func:IterFunc<WindowTile.BaseTiledWindow>):boolean {
			var self = this;
			if (!win) {
				self.log.warn("Layout.tile_for(null)");
				return false;
			}
			return this.tiles.each(function(tile:WindowTile.BaseTiledWindow, idx) {
				if (tile.window === win) {
					func(tile, idx);
					return STOP;
				}
				// self.log.warn("Layout.tile_for called on missing window: " + win);
				return null;
			});
		}
	
		managed_tile_for(win:Tiling.Window, func:IterFunc<WindowTile.BaseTiledWindow>) {
			// like @tile_for, but ignore floating windows
			var self = this;
			return this.tile_for(win, function(tile, idx) {
				if (self.tiles.is_tiled(tile)) {
					func(tile, idx);
				}
			});
		}
	
		tile(win:Tiling.Window) {
			var self = this;
			this.tile_for(win, function(tile) {
				tile.tile();
				self.layout();
			});
		}
	
		select_cycle(offset):boolean {
			return this.tiles.select_cycle(offset);
		}
	
		add(win:Tiling.Window, active_win:Tiling.Window) {
			var self = this;
			var found, tile;
			if (this.contains(win)) {
				return false;
			}
			tile = this.create_tile(win, this.state);
			found = this.tile_for(active_win, function(active_tile, active_idx) {
				self.tiles.insert_at(active_idx + 1, tile);
				self.log.debug("spliced " + tile + " into tiles at idx " + (active_idx + 1));
			});
			if (!found) {
				// no active tile, just add the new window at the end
				this.tiles.push(tile);
			}
			return true;
		}

		restore_original_positions() {
			// Sets all window positions back to original states.
			// NOTE: does _not_ actually release tiles, because
			// we may want to resume this state when the extension
			// gets re-enabled
			this.each_tiled(function(tile) {
				tile.restore_original_position();
			});
		}
	
		active_tile(fn:IterFunc<WindowTile.BaseTiledWindow>) {
			return this.tiles.active(fn);
		}
	
		cycle(diff) {
			this.tiles.cycle(diff);
			return this.layout();
		}
	
		minimize_window() {
			return this.active_tile(function(tile, idx) {
				return tile.minimize();
			});
		}
	
		unminimize_last_window() {
			return this.tiles.most_recently_minimized(function(win) {
				// TODO: this is a little odd...
				//       we do a relayout() as a result of the unminimize, and this
				//       is the only way to make sure we don't activate the previously
				//       active window.
				return WindowTile.BaseTiledWindow.with_active_window(win, function() { win.unminimize();});
			});
		}
	
		untile(win:Tiling.Window) {
			var self = this;
			this.tile_for(win, function(tile) {
				tile.release();
				self.layout();
			});
		}
	
		on_window_killed(win:Tiling.Window):boolean {
			var self = this;
			return this.tile_for(win, function(tile, idx) {
				self.tiles.remove_at(idx);
				self.layout();
			});
		}
	
		toggle_maximize() {
			var self = this;
			var active = null;
			this.active_tile(function(tile, idx) {
				active = tile;
			});
			if (active === null) {
				this.log.debug("active == null");
			}
			if (active === null) {
				return;
			}
			this.each(function(tile) {
				if (tile === active) {
					self.log.debug("toggling maximize for " + tile);
					tile.toggle_maximize();
				} else {
					tile.unmaximize();
				}
			});
		}
	
		on_window_moved(win:Tiling.Window) {
			return this.on_window_resized(win);
		}
	
		on_window_resized(win:Tiling.Window) {
			var self = this;
			var found = this.tile_for(win, function(tile, idx) {
				tile.update_desired_rect();
			});
			if (!found) {
				this.log.warn("couldn't find tile for window: " + win);
			}
		}

		override_external_change(win:Tiling.Window, delayed:boolean) { }
	
		// all the actions that are specific to an actual tiling layout are NOOP'd here,
		// so the keyboard handlers don't have to worry whether it's a valid thing to call
		
		on_split_resize_start(win:Tiling.Window) { }
	
		get_main_window_count(): number { throw "interface not implemented" }

		set_main_window_count(i: number) { }

		add_main_window_count(i) { }
		
		get_partition_count(): number { throw "interface not implemented" }

		set_partition_count(i: number) { }

		add_partition_count(i) { }
	
		adjust_main_window_area(diff) { }
	
		adjust_current_window_size(diff) { }
	
		scale_current_window(amount:number, axis?:string) {
			var bounds = this.bounds;
			this.active_tile(function(tile) {
				tile.update_desired_rect();
				tile.scale_by(amount, axis);
				tile.center_window();
				tile.ensure_within(bounds);
				tile.layout();
			});
		}

		adjust_split_for_tile(opts:{tile: WindowTile.BaseTiledWindow; diff_ratio: number; axis: string }) { }
	
		activate_main_window() { }
	
		swap_active_with_main() { }
	}

	class NonTiledLayout extends BaseLayout {
		protected create_tile(win: Tiling.Window, state: LayoutState) {
			return new WindowTile.FloatingWindowTile(win, state);
		}

		layout() {}
	}

	export class FloatingLayout extends NonTiledLayout {
		constructor(state) {
			super('FloatingLayout', state)
			this.tiles = new Tiling.FloatingTileCollection(state.bounds);
		}
	
		toString() {
			return "[object FloatingLayout]";
		}

		restore_original_positions() {
		}
	}
	
	export class FullScreenLayout extends NonTiledLayout {
		constructor(state) {
			super('FullScreenLayout', state);
		}
	
		toString() {
			return "[object FullScreenLayout]";
		}
	
		layout() {
			this.each_tiled(function(tile) {
				tile.window.maximize();
			});
		}
	}
	
	export abstract class BaseTiledLayout extends BaseLayout {
		main_split: Tiling.MultiSplit
		main_axis: string

		constructor(name, axis, state:LayoutState) {
			super(name, state);
			this.main_axis = axis;
			this.main_split = state.splits[this.main_axis];
		}

		protected create_tile(win: Tiling.Window, state: LayoutState) {
			return new WindowTile.TiledWindow(win, state);
		}

		toString() {
			return "[object BaseTiledLayout]";
		}
	
		layout() {
			this.bounds.update();
			var padding = LayoutState.padding;
			var layout_windows = this.tiles.for_layout();
			this.log.debug("laying out " + layout_windows.length + " windows");

			var new_splits = this.main_split.split(this.bounds, layout_windows, padding)
			new_splits.forEach(([bounds, window], idx) => this._layout_side(bounds, window, padding))
		}

		_layout_side(rect: Tiling.Rect, windows: WindowTile.BaseTiledWindow[], padding: number) {
			var axis = Tiling.Axis.other(this.main_axis);
			var rects = Tiling.Tile.split_rect(rect, axis, padding, windows.length)
			Tiling.ArrayUtil.zip(rects, windows).forEach(([rect, window]) => window.set_rect(rect))
		}

		get_main_window_count(): number {
			return this.main_split.primary_windows;
		}

		set_main_window_count(i: number) {
			this.main_split.primary_windows = i;
			return this.layout()
		}

	
		add_main_window_count(i: number) {
			return this.set_main_window_count(this.get_main_window_count() + i)
		}


		get_partition_count(): number {
			return this.main_split.max_partitions;
		}

		set_partition_count(i: number) {
			this.main_split.max_partitions = Math.max(1, i)
			return this.layout()
		}

		add_partition_count(i: number) {
			return this.set_partition_count(this.get_partition_count() + i);
		}

		adjust_main_window_area(diff) {
			this.main_split.adjust_ratio(diff);
			return this.layout();
		}
	
		adjust_current_window_size(diff) {
			var self = this;
			return this.active_tile(function(tile) {
				self.adjust_split_for_tile({
					tile: tile,
					diff_ratio: diff,
					axis: Tiling.Axis.other(self.main_axis)
				});
				self.layout();
			});
		}
	
		adjust_split_for_tile(opts) {
			var adjust, axis, diff_px, diff_ratio, tile;
			axis = opts.axis, diff_px = opts.diff_px, diff_ratio = opts.diff_ratio, tile = opts.tile;
			adjust = function(split, inverted) {
				if (diff_px != null) {
					split.adjust_ratio_px(inverted ? -diff_px : diff_px);
				} else {
					split.adjust_ratio(inverted ? -diff_ratio : diff_ratio);
				}
			};
			if (axis === this.main_axis) {
				adjust(this.main_split, !this.main_split.in_primary_partition(this.tiles.indexOf(tile)));
			} else {
				if (tile.bottom_split != null) {
					adjust(tile.bottom_split, false);
				} else if (tile.top_split != null) {
					adjust(tile.top_split, true);
				}
			}
		}
	
		activate_main_window() {
			this.tiles.main((win) => {
				win.activate();
			});
		}
	
		swap_active_with_main() {
			this.tiles.active((tile, idx) => {
				this.tiles.main((main_tile, main_idx) => {
					this.tiles.swap_at(idx, main_idx);
					this.layout();
				});
			});
		}
	
		on_window_moved(win:Tiling.Window) {
			var self = this;
			this.tile_for(win, function(tile, idx) {
				var moved;
				moved = false;
				if (tile.managed) {
					moved = self._swap_moved_tile_if_necessary(tile, idx);
				}
				if (!moved) {
					tile.update_desired_rect();
				}
				self.layout();
			});
		}
	
		on_window_resized(win) {
			var self = this;
			this.managed_tile_for(win, function(tile, idx) {
				var diff;
				tile.update_desired_rect();
				self.layout();
				return true;
			});
		}

		override_external_change(win:Tiling.Window, delayed:boolean) {
			// The window has resized itself. Put it back!
			var found = this.tile_for(win, function(tile, idx) {
				(tile as WindowTile.TiledWindow).enforce_layout(delayed);
			});
			if(!found) {
				this.log.warn("override_external_change called for unknown window " + win);
			}
		}
	
		_swap_moved_tile_if_necessary(tile, idx) {
			var self = this;
			var moved = false;
			if (this.tiles.is_tiled(tile)) {
				var mouse_pos = Tiling.get_mouse_position();
				this.each_tiled(function(swap_candidate, swap_idx) {
					var target_rect: Tiling.Rect;
					target_rect = Tiling.Tile.shrink(swap_candidate.rect, 20);
					if (swap_idx === idx) {
						return null;
					}
					if (Tiling.Tile.point_is_within(mouse_pos, target_rect)) {
						self.log.debug("swapping idx " + idx + " and " + swap_idx);
						self.tiles.swap_at(idx, swap_idx);
						moved = true;
						return STOP;
					}
					return null;
				});
			}
			return moved;
		}
	
		// private _log_state(lbl) {
		// 	var dump_win;
		// 	dump_win = function(w) {
		// 		return this.log.debug("	 - " + j(w.rect));
		// 	};
		// 	this.log.debug(" -------------- layout ------------- ");
		// 	this.log.debug(" // " + lbl);
		// 	this.log.debug(" - total windows: " + this.tiles.length);
		// 	this.log.debug("");
		// 	this.log.debug(" - main windows: " + this.mainsplit.primary_windows);
		// 	this.main_windows().map(dump_win);
		// 	this.log.debug("");
		// 	this.log.debug(" - minor windows: " + this.tiles.length - this.mainsplit.primary_windows);
		// 	this.minor_windows().map(dump_win);
		// 	return this.log.debug(" ----------------------------------- ");
		// }
	}
	
	export class VerticalTiledLayout extends BaseTiledLayout {
		constructor(state) {
			super('VerticalTiledLayout', 'x', state);
		}
	
		toString() {
			return "[object VerticalTiledLayout]";
		}
	}

	export class HorizontalTiledLayout extends BaseTiledLayout {
		constructor(state) {
			super('HorizontalTiledLayout', 'y', state);
		}
	
		toString() {
			return "[object HorizontalTiledLayout]";
		}
	}
	
}
