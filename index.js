/**
 * 模块加载器
 * define
 * fan.use
 * fan.config
 * fan.version
 * require.async
 * 
 * 模块路径规则：group/mod/version/path
 */
;(function(global, util){
	if(global.fan){
		return;
	}
	
	// 设置全局命名空间
	var fan = global.fan = {};
	
	// 配置
	var config = {
		// 加载根路径
		base: "",
		/**
		 * 合并分割符号
		 * 如：["!!", ","]
		 * 则：["a/b/c/d", "a/b/c/e", "a/b/m/n"] => "a/b!!c/d,c/e,m/n"
		 */
		comboSyntax: null
	};
	
	/**
	 * 版本
	 * {
	 * 		"group/mod": "version",
	 * 		... ...
	 * }
	 */
	var versions = {};
	
	// 获取路径的模块名
	// group/mod/... => group/mod
	function getModId(path){
		return path.split("/").slice(0, 2).join("/");
	}
	// 模块路径添加版本
	// group/mod/path => group/mod/version/path
	function resolveVersion(path){
		var ModId = getModId(path),
			version;
		// 如果存在版本记录，则将版本号注入到路径中
		if(version = versions[ModId]){
			path = path.replace(ModId, [ModId, version].join("/"));
		}
		
		return path;
	}
	
	// 获取模块版本
	function getVersion(path){
		var ModId = getModId(path);
		return versions[ModId];
	}
	
	// 获取路径
	// a/b/c/d => a/b/c/
	var DIRNAME_RE = /[^?#]*\//;
	function dirname(path) {
		return path.match(DIRNAME_RE)[0]
	}
	
	// 转换路径
	var DOT_RE = /\/\.\//g;
	var DOUBLE_DOT_RE = /\/[^/]+\/\.\.\//;
	var MULTI_SLASH_RE = /([^:/])\/+\//g;
	
	function realpath(path) {
		// /a/b/./c/./d ==> /a/b/c/d
		path = path.replace(DOT_RE, "/");
		
		/**
		 *	a//b/c ==> a/b/c
		 *	a///b/////c ==> a/b/c
		 *	DOUBLE_DOT_RE matches a/b/c//../d path correctly only if replace // with / first
		 */
		path = path.replace(MULTI_SLASH_RE, "$1/");
		
		// a/b/c/../../d  ==>  a/b/../d  ==>  a/d
		while (path.match(DOUBLE_DOT_RE)) {
			path = path.replace(DOUBLE_DOT_RE, "/");
		}
		
		return path;
	}
	
	/**
	 * 模块加载列表
	 * {
	 * 		"a/b": "__loading__",
	 * 		"a/c": "__waiting__",
	 * 		"a/d": [Object],
	 * 		... ...
	 * }
	 */
	var mods = {};
	
	// 模块加载状态
	// 加载中
	var LOADING = "__loading__";
	// 等待解析中
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
		
		// 修改模块状态，加入待加载列表
		mods[id] = LOADING;
		requestList.push(id);
		
		function request(){
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
							// 本地存储中存在该模块，加入待解析模块列表
							storeList.push({
								id: id,
								mod: mod
							});
							continue;
						}
					}
					// 将路径加入待加载列表
					ids.push(resolveVersion(id).replace(/\.js$/, "") + ".js");
				}
			}
			requestList = [];
			
			// 解析存储中的模块
			var store;
			for(i = 0, l = storeList.length; i < l; i ++){
				store = storeList[i];
				global.define(store.id, store.mod.deps, store.mod.factory, true);
			}
			
			// 加载需加载模块
			if(ids.length){
				if(ids.length === 1){
					script.src = [config.base, ids[0]].join("/");
				}else{
					// 多个文件按规则合并路径
					script.src = config.base + config.comboSyntax[0] + ids.join(config.comboSyntax[1]);
				}
				head.appendChild(script);
			}else{
				script = null;
			}
		}
		
		if(config.comboSyntax){
			if(requestHandler){
				clearTimeout(requestHandler);
			}
			
			requestHandler = setTimeout(request, 1);
		}else{
			request();
		}
	}
	
	// seed列表
	var seeds = {};
	
	var checkSeed = (function(){
		// 检查依赖id的模块列表
		function checkSeeds(id){
			var _seeds = seeds[id] || [];
			// 此处每次循环都取length防止循环过程中，列表新增feed
			for(var i = 0; i < _seeds.length; i ++){
				checkSeed(_seeds[i]);
				//if(checkSeed(_seeds[i])){
				//	_seeds.splice(i, 1);
				//	i --;
				//}
			}
			
			delete seeds[id];
		}
		
		// 检查模块依赖是否ready
		var tmpMod = {};
		
		return function(seed){
			var deps = seed.deps;
			
			for(var i = 0, l = deps.length, dep, mod; i < l; i ++){
				dep = deps[i];
				
				if(!(mod = mods[deps[i]])){
					// 如果模块还未加载，则去加载模块
					request(dep);
				}
				// 由于模块加载可能异步，也可能同步，所以需要二次判断
				if(mod || (mod = mods[deps[i]])){
					// 假如模块已经加载解析完成，从依赖中去掉
					if(mod !== LOADING && mod !== WAITING){
						deps.splice(i, 1);
						i --;
						l --;
					}
				}
			}
			
			var _require;
			
			// 如果依赖都已加载解析完成，则解析模块的工厂方法
			if(deps.length === 0){
				if(seed.id){
					tmpMod.exports = {};
					
					_require = function(id){
						// 转换相对路径
						if(/^(\.){1,2}\//.test(id)){
							id = realpath([dirname(seed.id), id].join("/"));
						}
						return require(id);
					};
					
					_require.async = fan.use;
					
					seed.factory(_require, tmpMod.exports, tmpMod);
					
					mods[seed.id] = tmpMod.exports;
					
					// 检查依赖该模块的其他模块
					checkSeeds(seed.id);
				}else{
					seed.factory();
				}
				
				return true;
			}
			
			return false;
		};
	})();
	
	/**
	 * 
	 */
	global.define = function(id, deps, factory, noStore){
		if(id){
			// 设置模块为待解析状态
			mods[id] = WAITING;
			// 将模块存入本地
			if(util.store && !noStore){
				util.store.set(id, getVersion(id), deps, factory);
			}
		}
		
		// 生成模块加载种子
		var seed = {
			id: id,
			deps: deps,
			factory: factory
		};
		
		var i, l, dep;
		if(!checkSeed(seed)){
			// 假如有依赖模块未加载，将种子加入依赖模块监听队列
			for(i = 0, l = deps.length; i < l; i ++){
				dep = deps[i];
				if(!seeds[dep]){
					seeds[dep] = [];
				}
				seeds[dep].push(seed);
			}
		}
	};
	
	/**
	 * 
	 */
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
	
	/**
	 * 配置加载参数
	 */
	fan.config = function(_config){
		for(var key in _config){
			if(_config.hasOwnProperty(key)){
				config[key] = _config[key];
			}
		}
	};
	
	/**
	 * 配置版本号
	 * fan.version("groupName", {
	 * 		"modName": "v.1",
	 * 		"modName": "v.2"
	 * })
	 */
	fan.version = function(group, version){
		for(var modName in version){
			versions[[group, modName].join("/")] = version[modName];
		}
	};
	
	// 兼容seajs
	global.seajs = global.fan;
	global.mods = mods;
})(this, (function(){
	// 本地存储模块
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
