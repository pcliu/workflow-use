# MCP Server 设置指南

## 概述

本文档描述如何设置和运行 Workflow Use 的 MCP (Model Context Protocol) 服务器，用于将工作流暴露为 Claude 等 AI 系统可调用的工具。

## 功能特性

- **自动工具注册**: 扫描指定目录的 `*.workflow.json` 文件，自动注册为 MCP 工具
- **动态签名生成**: 根据工作流的 `input_schema` 动态生成函数签名和参数
- **工作流执行**: 通过 MCP 协议执行工作流并返回结构化结果

## 环境要求

- Python 虚拟环境已激活
- OpenAI API Key 已配置
- 工作流 JSON 文件存在于指定目录

## 运行方式

### 1. 直接运行 (stdio 模式)

```bash
# 使用虚拟环境的绝对路径
/Users/liupengcheng/Documents/Code/workflow-use/workflows/.venv/bin/python /Users/liupengcheng/Documents/Code/workflow-use/workflows/workflow_use/mcp/stdio_server.py
```

### 2. 带环境变量运行

```bash
# 设置工作流目录和 API Key
WORKFLOW_DIR=/Users/liupengcheng/Documents/Code/workflow-use/workflows/examples OPENAI_API_KEY= your key
```

### 3. 测试依赖

```bash
# 验证依赖是否正确安装
/Users/liupengcheng/Documents/Code/workflow-use/workflows/.venv/bin/python -c "from langchain_openai import ChatOpenAI; print('Dependencies OK')"
```

## Claude Desktop 集成

### 配置文件位置

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 配置示例

```json
{
  "mcpServers": {
    "workflow-use": {
      "command": "/Users/liupengcheng/Documents/Code/workflow-use/workflows/.venv/bin/python",
      "args": ["/Users/liupengcheng/Documents/Code/workflow-use/workflows/workflow_use/mcp/stdio_server.py"],
      "env": {
        "WORKFLOW_DIR": "/Users/liupengcheng/Documents/Code/workflow-use/workflows/examples",
        "OPENAI_API_KEY": "your key"
      }
    }
  }
}
```

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `WORKFLOW_DIR` | 工作流 JSON 文件目录 | `./tmp` |
| `OPENAI_API_KEY` | OpenAI API 密钥 | 必须设置 |

## 工作流目录

MCP 服务器会扫描以下目录中的 `*.workflow.json` 文件：
- `./tmp/` (默认)
- `./examples/` (推荐用于生产环境)

## 故障排除

### 1. 依赖缺失错误
```bash
# 确保虚拟环境已激活并安装依赖
cd /Users/liupengcheng/Documents/Code/workflow-use/workflows
source .venv/bin/activate
uv sync
```

### 2. API Key 未设置
确保 `OPENAI_API_KEY` 环境变量已正确设置或在 `.env` 文件中配置。

### 3. 工作流文件未找到
检查 `WORKFLOW_DIR` 路径是否正确，且包含有效的 `*.workflow.json` 文件。

### 4. Claude Desktop 连接失败
- 重启 Claude Desktop 应用
- 检查配置文件 JSON 格式是否正确
- 验证文件路径是否存在

## 日志输出

MCP 服务器启动时会输出类似信息：
```
[FastMCP Service] Found workflow files in './examples': 2
[FastMCP Service] Loading workflow from: ./examples/example.workflow.json
[FastMCP Service] Registered tool (via signature): 'Example_Workflow_1.0' for 'Example Workflow'. Params: ['input_param']
```

## 安全注意事项

- 不要在公共代码库中提交 API Key
- 使用环境变量或 `.env` 文件管理敏感信息
- 定期轮换 API Key

---

**最后更新**: 2025-01-04  
**项目路径**: `/Users/liupengcheng/Documents/Code/workflow-use/workflows/`