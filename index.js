/**
 * 模块加载器
 * define
 * fan.use
 * fan.config
 * fan.version
 * require.async
 */
;(function(global, util){
	if(global.fan){
		return;
	}
	
	var fan = global.fan = {};
	
	var config = {
		base: "",
		comboSyntax: ["!!", ","]
	};
	
	var versions = {};
	
	function resolveVersion(id){
		var groupAndMod = id.split("/").slice(0, 2).join("/"),
			version;
		if(version = versions[groupAndMod]){
			id = id.replace(groupAndMod, [groupAndMod, version].join("/"));
		}
		
		return id;
	}
	
	function getVersion(id){
		var groupAndMod = id.split("/").slice(0, 2).join("/");
		return versions[groupAndMod];
	}
	
	var DIRNAME_RE = /[^?#]*\//;
	
	function dirname(path) {
		return path.match(DIRNAME_RE)[0]
	}
	
	var DOT_RE = /\/\.\//g;
	var DOUBLE_DOT_RE = /\/[^/]+\/\.\.\//;
	var MULTI_SLASH_RE = /([^:/])\/+\//g;
	
	function realpath(path) {
		// /a/b/./c/./d ==> /a/b/c/d
		path = path.replace(DOT_RE, "/")
		
		/*
		a//b/c ==> a/b/c
		a///b/////c ==> a/b/c
		DOUBLE_DOT_RE matches a/b/c//../d path correctly only if replace // with / first
		*/
		path = path.replace(MULTI_SLASH_RE, "$1/")
		
		// a/b/c/../../d  ==>  a/b/../d  ==>  a/d
		while (path.match(DOUBLE_DOT_RE)) {
			path = path.replace(DOUBLE_DOT_RE, "/")
		}
		
		return path
	}
	
	// 模块列表
	var mods = {};
	var LOADING = "__loading__";
	var WAITING = "__waiting__";
	// 返回模块
	function require(id){
		return mods[id];
	}
	
	var doc = global.document;
	var head = doc.head || doc.getElementsByTagName("head")[0] || doc.documentElement;
	// 请求文件
	var requestList = [];
	var requestHandler = null;
	function request(id){
		if(!id || mods[id]){
			return;
		}
		
		mods[id] = LOADING;
		requestList.push(id);
		
		if(requestHandler){
			clearTimeout(requestHandler);
		}
		
		requestHandler = setTimeout(function(){
			requestHandler = null;
			
			var script = doc.createElement("script");
			
			function onload(){
				script.onload = script.onerror = script.onreadystatechange = null;
				head.removeChild(script);
				script = null;
			}
			
			if("onload" in script){
				script.onload = onload;
				script.onerror = function(){
					//console.error(id + " load fail");
					onload();
				};
			}else{
				script.onreadystatechange = function(){
					if(/loaded|complete/.test(script.readyState)){
						onload();
					}
				};
			}
			
			script.async = true;
			
			var ids = [],
				id,
				mod,
				storeList = [];
			for(var i = 0, l = requestList.length; i < l; i ++){
				id = requestList[i];
				if(mods[id] === LOADING){
					if(util.store){
						mod = util.store.get(id, getVersion(id));
						if(mod){
							storeList.push({
								id: id,
								mod: mod
							});
							continue;
						}
					}
					ids.push(resolveVersion(id).replace(/\.js$/, "") + ".js");
				}
			}
			requestList = [];
			
			var store;
			for(i = 0, l = storeList.length; i < l; i ++){
				store = storeList[i];
				global.define(store.id, store.mod.deps, store.mod.factory, true);
			}
			
			if(ids.length){
				if(ids.length === 1){
					script.src = [config.base, ids[0]].join("/");
				}else{
					script.src = config.base + config.comboSyntax[0] + ids.join(config.comboSyntax[1]);
				}
				head.appendChild(script);
			}else{
				script = null;
			}
		}, 1);
	}
	
	// feed列表
	var feeds = {};
	
	var checkFeed = (function(){
		// 检查模块依赖是否ready
		var tmpMod = {};
		function checkFeed(feed){
			var deps = feed.deps;
			
			for(var i = 0, l = deps.length, dep, mod; i < l; i ++){
				dep = deps[i];
				if(mod = mods[deps[i]]){
					if(mod !== LOADING && mod !== WAITING){
						deps.splice(i, 1);
						i --;
						l --;
					}
				}else{
					request(dep);
				}
			}
			
			var _require;
			
			if(deps.length === 0){
				if(feed.id){
					tmpMod.exports = {};
					
					_require = function(id){
						// 转换相对路径
						if(/^(\.){1,2}\//.test(id)){
							id = realpath([dirname(feed.id), id].join("/"));
						}
						return require(id);
					};
					
					_require.async = fan.use;
					
					feed.factory(_require, tmpMod.exports, tmpMod);
					
					mods[feed.id] = tmpMod.exports;
					
					checkFeeds(feed.id);
				}else{
					feed.factory();
				}
				
				return true;
			}
			
			return false;
		}
		
		// 检查依赖id的模块列表
		function checkFeeds(id){
			var _feeds = feeds[id] || [];
			// 此处每次循环都取length防止循环过程中，列表新增feed
			for(var i = 0; i < _feeds.length; i ++){
				if(checkFeed(_feeds[i])){
					_feeds.splice(i, 1);
					i --;
				}
			}
		}
		
		return checkFeed;
	})();
	
	global.define = function(id, deps, factory, noStore){
		if(id){
			mods[id] = WAITING;
		}
		
		if(util.store && !noStore && id){
			util.store.set(id, getVersion(id), deps, factory);
		}
		
		var feed = {
			id: id,
			deps: deps,
			factory: factory
		};
		
		var i, l, dep;
		if(!checkFeed(feed)){
			for(i = 0, l = deps.length; i < l; i ++){
				dep = deps[i];
				if(!feeds[dep]){
					feeds[dep] = [];
				}
				feeds[dep].push(feed);
			}
		}
	};
	
	fan.use = function(ids, callback){
		// 转为数组
		ids = [].concat(ids);
		global.define("", [].concat(ids), function(){
			for(var i = 0, l = ids.length; i < l; i ++){
				ids[i] = require(ids[i]);
			}
			callback.apply(global, ids);
		});
	};
	//
	fan.config = function(_config){
		for(var key in _config){
			if(_config.hasOwnProperty(key)){
				config[key] = _config[key];
			}
		}
	};
	// 配置版本号
	fan.version = function(group, version){
		for(var modName in version){
			versions[[group, modName].join("/")] = version[modName];
		}
	};
	
	global.seajs = global.fan;
	global.mods = mods;
})(this, (function(){
	var store,
		win = window,
		localStorageName = 'localStorage',
		globalStorageName = 'globalStorage',
		storage;
	
	if(JSON){
		if (localStorageName in win && win[localStorageName]) {
			storage = win[localStorageName];
			store = {
				get: function (key) {
					return storage.getItem(key);
				},
				set: function (key, val) {
					storage.setItem(key, val);
				},
				remove: function (key) {
					storage.removeItem(key);
				}
			};
		} else if (globalStorageName in win && win[globalStorageName]) {
			storage = win[globalStorageName][win.location.hostname];
			store = {
				get: function (key) {
					return storage[key] && storage[key].value;
				},
				set: function (key, val) {
					storage[key] = val;
				},
				remove: function (key) {
					delete storage[key];
				}
			};
		}
	}
	
	function parseJson(data){
		try{
		    return ( new Function( "return " + data.replace(/^\s+|\s+$/g, "") ) )();
		}catch(e){
			return null;
		}
	}
	
	var modManageKey = "mod-visit-manager";
	function getModManage(){
		var config = store.get(modManageKey);
		if(config && (config = JSON.parse(config))){
			return config;
		}else{
			return {};
		}
	}
	
	function setModManage(config){
		store.set(modManageKey, JSON.stringify(config));
	}
	
	function getNow(){
		return ((new Date() - new Date(2015, 0, 1)) / (24 * 3600 * 1000)) | 0;
	}
	function updateModVisitTime(id){
		var config = getModManage();
		config[id] = getNow();
		setModManage(config);
	}
	
	function deleteMod(id){
		var config = getModManage();
		delete config[id];
		setModManage(config);
	}
	// 30天未访问模块删除
	var expires = 30;
	function clearMod(){
		var config = getModManage();
		var now = getNow();
		for(var id in config){
			if(now - config[id] > expires){
				delete config[id];
			}
		}
		setModManage(config);
	}
	
	setTimeout(clearMod, 5000);
	
	return {
		store: store ? {
			get: function(id, version){
				var mod = store.get(id);
				if(mod){
					if((mod = JSON.parse(mod)) && mod.version === version){
						updateModVisitTime(id);
						return {
							deps: mod.deps,
							factory: parseJson(mod.factory)
						};
					}else{
						store.remove(id);
						deleteMod(id);
					}
				}
			},
			set: function(id, version, deps, factory){
				store.set(id, JSON.stringify({
					version: version,
					deps: deps,
					factory: factory.toString()
				}));
				updateModVisitTime(id);
			}
		} : null
	};
})());