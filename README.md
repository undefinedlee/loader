# loader
模块加载器，自动合并请求，本地存储

## 模块路径规则：[组]/[项目]/[版本]/[文件]

## 定义模块
define(id, deps, factory)
        factory(require, exports, module)

## 加载模块
fan.use(deps, factory)
        factory([mods])

## 配置
fan.config(config)

## 配置版本
fan.version(group, versions)

## 加载模块
require.async(deps, factory)
        factory([mods])
