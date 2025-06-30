# DOM 内容提取功能开发进度报告

## 📋 项目概述

实现DOM-based内容提取功能，支持在录制和回放workflow时精确提取复杂DOM结构的内容（如评论、评分、时间戳等）。

## 🏗️ 系统架构

### 两阶段提取方案

**Stage 1 (录制阶段)**：
- 用户友好的自然语言标记
- 右键菜单 "Extract Content..." 
- 弹框输入自然语言提取规则
- 生成初始JSON数据

**Stage 2 (构建阶段)**：
- LLM解析自然语言规则
- 生成精确的CSS选择器和字段映射
- 创建可执行的workflow步骤

## ✅ 已完成任务

### 🎯 Stage 1 - 录制阶段 (已完成)

1. **✅ 扩展录制阶段** - 在 browser extension 中添加 DOM 内容标记功能
2. **✅ 修改 content script** - 捕获 DOM 选择器和内容区域信息  
3. **✅ 扩展 WorkflowController** - 添加 DOM 内容提取方法
4. **✅ Workflow schema** - 添加 extract_dom_content 步骤类型
5. **✅ 粗粒度标记 + 自然语言输入** - 实现弹框界面
6. **✅ 生成初始JSON** - 包含自然语言规则的数据结构

### 🔧 基础设施 (已完成)

7. **✅ 状态同步修复** - 解决页面刷新时按钮状态不同步问题
8. **✅ UI事件过滤** - 防止标记操作被记录为workflow步骤
9. **✅ EventViewer更新** - 正确显示extract_content_marked步骤
10. **✅ 代码清理** - 移除冗余的contentType系统，简化架构

## 🚧 当前状态

### Stage 1 功能完整可用：
- ✅ 录制时点击"Mark Content"按钮激活标记模式
- ✅ 右键显示"Extract Content..."菜单
- ✅ 弹框输入自然语言提取规则（如"提取数字"）
- ✅ 生成完整的JSON数据结构
- ✅ 在sidepanel正确显示extract_content_marked事件
- ✅ 状态在页面刷新后保持同步

### 最新测试数据示例：
```json
{
  "type": "extract_content_marked",
  "timestamp": 1751272628254,
  "tabId": 1601950969,
  "url": "https://book.douban.com/subject/37241684/",
  "xpath": "id(\"interest_sectl\")/div[1]/div[2]/strong[1]",
  "cssSelector": "strong.ll.rating_num",
  "elementTag": "STRONG",
  "elementText": "8.9",
  "extractionRule": "提取数字",
  "multiple": false,
  "htmlSample": "<strong class=\"ll rating_num \" property=\"v:average\"> 8.9 </strong>",
  "selectors": [
    {
      "type": "css",
      "value": "strong.ll.rating_num",
      "priority": 1
    },
    {
      "type": "xpath", 
      "value": "id(\"interest_sectl\")/div[1]/div[2]/strong[1]",
      "priority": 2
    }
  ]
}
```

## 🎯 下一步任务 (待完成)

### Stage 2 - LLM智能解析 (高优先级)

13. **🔄 扩展BuilderService支持LLM解析自然语言规则**
    - 修改 `workflow_use/builder/service.py`
    - 添加自然语言解析逻辑
    - 将"提取数字"转换为精确的提取指令

14. **🔄 生成精确的CSS选择器和字段映射**
    - 基于HTML样本和自然语言规则
    - 生成最优选择器策略
    - 处理动态内容和结构变化

### 核心功能完善 (中优先级)

5. **🔄 实现选择器优先级和降级策略**
   - CSS选择器失败时自动降级到XPath
   - 智能选择器生成算法

6. **🔄 修改 BuilderService 支持生成 DOM 提取步骤**
   - 在workflow构建时识别extract_content_marked事件
   - 转换为可执行的extract_dom_content步骤

7. **🔄 在 Workflow 执行引擎中集成 DOM 内容提取**
   - workflow运行时执行DOM提取步骤
   - 支持变量替换和数据输出

### 增强功能 (低优先级)

15. **📋 添加预设模板** - 电商评论、新闻文章等常见提取模式
16. **📋 实现智能建议和可视化预览** - 提取前预览效果
8. **📋 添加 DOM 提取的测试用例和示例**
9. **📋 更新 CLI 工具支持 DOM 提取功能**
10. **📋 在 Web UI 中添加 DOM 提取步骤的可视化编辑**

## 📁 关键文件列表

### Frontend (Browser Extension)
- `extension/src/entrypoints/content.ts` - DOM标记和提取逻辑
- `extension/src/entrypoints/background.ts` - 事件处理和状态管理
- `extension/src/entrypoints/sidepanel/components/event-viewer.tsx` - UI显示
- `extension/src/lib/workflow-types.ts` - TypeScript类型定义
- `extension/src/lib/message-bus-types.ts` - 消息传递接口

### Backend (Python)
- `workflows/workflow_use/controller/service.py` - DOM提取执行逻辑
- `workflows/workflow_use/controller/views.py` - 数据模型定义
- `workflows/workflow_use/builder/service.py` - **下一步重点：需要扩展LLM解析**
- `workflows/workflow_use/workflow/service.py` - workflow执行引擎

## 🔥 关键成就

1. **创新的两阶段架构** - 平衡了用户体验和技术精度
2. **完整的状态同步机制** - 解决了复杂的跨组件状态管理
3. **智能UI事件过滤** - 精确区分页面操作和标记操作
4. **清洁的代码架构** - 移除冗余代码，统一数据结构
5. **健壮的错误处理** - 多层级的降级策略

## 🚀 下次开发建议

**立即优先级：Stage 2 LLM解析**
1. 首先实现 `BuilderService` 中的自然语言解析
2. 创建测试用例验证"提取数字"等规则的转换
3. 集成到workflow执行流程中

**技术难点预测：**
- LLM prompt工程，确保准确理解提取意图
- 处理复杂HTML结构的边界情况
- 选择器生成的鲁棒性和性能优化

**建议的开发顺序：**
1. BuilderService LLM集成 (任务13)
2. 精确选择器生成 (任务14) 
3. Workflow执行引擎集成 (任务7)
4. 端到端测试和优化

---

*最后更新：2025年6月30日*
*当前进度：Stage 1 完成，Stage 2 待开发*