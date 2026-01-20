# Daily Life Feature Implementation Guide

## Overview
This document describes the implementation of the "Daily Life" feature that allows users to manage their daily schedule/todo list and include it as context in conversations with the AI assistant.

## Backend Changes (✅ Completed)

### 1. WebSocket Message Schema Extension
**File**: `src/open_llm_vtuber/websocket_handler.py`

Added optional `daily_schedule` field to `WSMessage` TypedDict:
```python
class WSMessage(TypedDict, total=False):
    # ... existing fields ...
    daily_schedule: Optional[str]
```

### 2. Context Passing
**File**: `src/open_llm_vtuber/conversations/conversation_handler.py`

- Extract `daily_schedule` from incoming WebSocket message
- Pass it via metadata to conversation processors

### 3. Input Type Extension
**File**: `src/open_llm_vtuber/agent/input_types.py`

Added new `TextSource` enum value:
```python
class TextSource(Enum):
    INPUT = "input"
    CLIPBOARD = "clipboard"
    DAILY_SCHEDULE = "daily_schedule"  # NEW
```

### 4. Batch Input Creation
**File**: `src/open_llm_vtuber/conversations/conversation_utils.py`

Modified `create_batch_input()` to inject daily schedule as context text when present in metadata.

### 5. Prompt Assembly
**File**: `src/open_llm_vtuber/agent/agents/basic_memory_agent.py`

Updated `_to_text_prompt()` to format daily schedule with proper context markers:
```
[User's daily schedule:
<schedule content>]
```

## Frontend Implementation (📋 TODO)

### Required Changes in `Open-LLM-VTuber-Web` Repository

### 1. Add "Daily Life" Icon Button

**Location**: Navigation header component (likely `src/components/Layout/Header.tsx` or similar)

**Position**: After the "Change Mode" icon button

**Implementation**:
```tsx
// Add icon import (use Material-UI or whatever icon library the project uses)
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'; // or similar

// Add state for drawer
const [dailyLifeOpen, setDailyLifeOpen] = useState(false);

// In the header buttons section, after "Change Mode":
<IconButton
  onClick={() => setDailyLifeOpen(true)}
  aria-label="Daily Life"
  title="Daily Life Schedule"
>
  <CalendarTodayIcon />
</IconButton>
```

### 2. Create Daily Life Drawer Component

**New File**: `src/components/DailyLife/DailyLifeDrawer.tsx`

**Features**:
- Drawer/modal that slides from right (similar to existing drawers)
- Header: "Today's Schedule" with current date
- Todo list with checkboxes
- "Add Item" input field
- Repeat options (including custom weekdays and intervals)
- "Clear Completed" button
- "Add to Chat" toggle/button (see options below)

**Recurring delete behavior**:
- For recurring items, clicking the trash icon deletes *today's occurrence only* (it will not come back on reload).
- Shift+clicking the trash icon stops the recurrence entirely.

**Data Structure**:
```typescript
interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  timestamp: number;
  // Optional recurrence settings (offline-only)
  repeat?:
    | 'none'
    | 'daily'
    | 'every_other_day'
    | 'weekday'
    | 'weekly'
    | 'monthly'
    | 'weekly_days'        // custom weekdays
    | 'interval_days'      // every N days
    | 'interval_weeks';    // every N weeks

  // Extra repeat configuration when using advanced patterns
  repeat_config?: {
    interval?: number;    // for interval_days / interval_weeks
    weekdays?: number[];  // 0=Sun..6=Sat for weekly_days / interval_weeks
  };
  // When set, this item is an instance generated from a recurring template
  recurring_id?: string;
}

interface DailySchedule {
  date: string; // YYYY-MM-DD
  items: TodoItem[];
}
```

**Storage**:
```typescript
// Use localStorage with date-based keys
const STORAGE_KEY_PREFIX = 'daily_schedule_';

// Recurring templates are stored separately and expanded into each day
const RECURRING_STORAGE_KEY = 'daily_life_recurring_todos';

const saveDailySchedule = (date: string, items: TodoItem[]) => {
  localStorage.setItem(
    `${STORAGE_KEY_PREFIX}${date}`,
    JSON.stringify({ date, items })
  );
};

const loadDailySchedule = (date: string): DailySchedule | null => {
  const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${date}`);
  return stored ? JSON.parse(stored) : null;
};
```

### 3. Format Schedule for Backend

**Utility Function**: `src/components/DailyLife/formatSchedule.ts`

```typescript
export const formatScheduleForChat = (items: TodoItem[]): string => {
  if (!items || items.length === 0) return '';
  
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const lines = [`Daily schedule (${today}):`];
  
  items.forEach(item => {
    const status = item.completed ? '✓' : '○';
    lines.push(`${status} ${item.text}`);
  });
  
  return lines.join('\n');
};
```

### 4. Integrate with Chat WebSocket

**Option A: One-Shot Button (Recommended)**

When user clicks "Add to Chat" button, immediately inject the schedule into the next message:

```typescript
// In DailyLifeDrawer component
const handleAddToChat = () => {
  const scheduleText = formatScheduleForChat(todayItems);
  // Store in a global/context state that chat input can read
  addScheduleToNextMessage(scheduleText);
  setDailyLifeOpen(false);
  // Show toast: "Schedule added to next message"
};
```

**Option B: Persistent Toggle**

Toggle switch in the drawer that controls whether schedule is always included:

```typescript
const [alwaysInclude, setAlwaysInclude] = useState(false);

// When sending messages, check this flag and include schedule
if (alwaysInclude) {
  const scheduleText = formatScheduleForChat(getTodayItems());
  messagePayload.daily_schedule = scheduleText;
}
```

### 5. Modify Message Sending Logic

**File**: WebSocket message handler (likely `src/services/websocket.ts` or similar)

When sending `text-input` or `mic-audio-end` messages, include `daily_schedule` field:

```typescript
const sendMessage = (text: string, options: MessageOptions = {}) => {
  const payload = {
    type: 'text-input',
    text: text,
    // ... other fields ...
  };
  
  // Add daily schedule if provided
  if (options.dailySchedule) {
    payload.daily_schedule = options.dailySchedule;
  }
  
  websocket.send(JSON.stringify(payload));
};
```

### 6. Size Constraints

To avoid excessive token usage and maintain low latency:

```typescript
const MAX_TODO_ITEMS = 20;
const MAX_ITEM_LENGTH = 100;
const MAX_TOTAL_LENGTH = 500;

// Truncate if needed before sending
const formatScheduleForChat = (items: TodoItem[]): string => {
  let filtered = items.slice(0, MAX_TODO_ITEMS);
  filtered = filtered.map(item => ({
    ...item,
    text: item.text.slice(0, MAX_ITEM_LENGTH)
  }));
  
  let result = /* format as shown above */;
  
  if (result.length > MAX_TOTAL_LENGTH) {
    result = result.slice(0, MAX_TOTAL_LENGTH) + '\n...';
  }
  
  return result;
};
```

### 7. UI/UX Recommendations

**Daily Life Drawer Layout**:
```
┌─────────────────────────────────────┐
│  Today's Schedule - Jan 19, 2026  ✕ │
├─────────────────────────────────────┤
│                                     │
│  ☐ Morning workout                  │
│  ☐ Team meeting at 10am             │
│  ☑ Review code PRs                  │
│  ☐ Lunch with client                │
│                                     │
│  [+ Add item]                       │
│                                     │
├─────────────────────────────────────┤
│  [Clear Completed]                  │
│                                     │
│  [ Add to Chat ]  ← Primary button  │
└─────────────────────────────────────┘
```

**Behavior**:
- Auto-load today's schedule when drawer opens
- Auto-save on any change (add/edit/delete/check)
- Show confirmation toast when added to chat
- Consider showing schedule in a compact preview in chat input area when "queued"

### 8. Translation Support

Add i18n keys for new strings:
```json
{
  "dailyLife": {
    "title": "Daily Life",
    "todaySchedule": "Today's Schedule",
    "addItem": "Add item",
    "clearCompleted": "Clear Completed",
    "addToChat": "Add to Chat",
    "noItems": "No items for today",
    "addedToast": "Schedule added to chat context"
  }
}
```

Chinese:
```json
{
  "dailyLife": {
    "title": "日常生活",
    "todaySchedule": "今日日程",
    "addItem": "添加项目",
    "clearCompleted": "清除已完成",
    "addToChat": "添加到对话",
    "noItems": "今日无安排",
    "addedToast": "日程已添加到对话上下文"
  }
}
```

## Testing

### Backend Testing
1. Send WebSocket message with `daily_schedule` field:
```json
{
  "type": "text-input",
  "text": "What should I do next?",
  "daily_schedule": "Daily schedule (2026-01-19):\n○ Morning workout\n○ Team meeting at 10am\n✓ Review code PRs"
}
```

2. Verify the schedule appears in the prompt sent to LLM (check logs with debug level)

3. Verify AI responds with awareness of the schedule

### Frontend Testing
1. Click "Daily Life" icon → drawer opens
2. Add/edit/delete/check items → persists in localStorage
3. Click "Add to Chat" → schedule is included in next message
4. Send message → verify AI acknowledges schedule context
5. Refresh page → schedule persists
6. Test on different dates → separate schedules

## Backward Compatibility

✅ The `daily_schedule` field is **optional** in the WebSocket message schema. Old frontend versions will continue to work without any changes.

## Performance Considerations

- **Token Usage**: A 10-item schedule adds ~200 tokens to each request where it's included
- **Latency**: Minimal impact (<10ms for formatting)
- **Storage**: Each daily schedule ~1-5KB in localStorage
- **Recommendation**: Use "Add to Chat" button (one-shot) rather than "always include" toggle to minimize token usage

## Security Considerations

- Schedule data is stored locally (localStorage) - no server-side persistence
- No PII is sent to backend unless user explicitly includes it in todo items
- Consider adding a "clear all schedules" option for privacy

## Future Enhancements (Optional)

1. **Weekly/Monthly View**: Expand beyond "today"
2. **Schedule Templates**: Pre-defined schedule patterns
3. **Smart Suggestions**: AI suggests todo items based on chat history
4. **Reminders**: Browser notifications for upcoming items
5. **Export/Import**: Share schedules between devices
6. **Analytics**: Track completion rates over time

## Related Files

### Backend
- [src/open_llm_vtuber/websocket_handler.py](src/open_llm_vtuber/websocket_handler.py)
- [src/open_llm_vtuber/conversations/conversation_handler.py](src/open_llm_vtuber/conversations/conversation_handler.py)
- [src/open_llm_vtuber/conversations/conversation_utils.py](src/open_llm_vtuber/conversations/conversation_utils.py)
- [src/open_llm_vtuber/agent/input_types.py](src/open_llm_vtuber/agent/input_types.py)
- [src/open_llm_vtuber/agent/agents/basic_memory_agent.py](src/open_llm_vtuber/agent/agents/basic_memory_agent.py)

### Frontend (to be created)
- `src/components/DailyLife/DailyLifeDrawer.tsx`
- `src/components/DailyLife/formatSchedule.ts`
- `src/components/Layout/Header.tsx` (modify)
- `src/services/websocket.ts` (modify)

## Questions?

If you have questions about implementation details, please refer to:
- Frontend docs: https://docs.llmvtuber.com/docs/user-guide/frontend
- Backend docs: https://docs.llmvtuber.com/docs/user-guide/backend
