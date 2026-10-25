import { getContext } from '../../../extensions.js';

const MODULE = 'persona-forge';

const SEEDS = {
    身份: ['落魄的江湖郎中', '书院的年轻先生', '刚入行的法医', '深夜电台的主播', '边陲小镇的驿丞', '退役的赛车手', '古籍修复师', '流浪的乐师', '失忆的旅人', '灯塔看守人', '画廊的实习策展人', '城中最年轻的捕快'],
    性格: ['嘴硬心软', '安静克制、认真到有点轴', '懒散但关键时刻很可靠', '爱操心、爱碎碎念', '表面温和、骨子里倔', '不爱说话但观察力极强', '爱开玩笑、用笑掩饰心事', '谨慎多疑、慢热', '冲动敢闯、不计后果', '清醒到近乎冷淡'],
    外貌: ['眉眼清冷，笑起来很柔和', '总是穿洗得发白的旧衬衫', '手腕上有一道旧疤', '头发随意扎起，几缕碎发垂在耳边', '身形清瘦，指节分明', '眼下常年有淡淡的青色', '笑时有一颗小虎牙', '戴一副细边眼镜，说话时爱推一推'],
    小习惯: ['紧张时会反复捏衣角', '喝茶只喝凉的', '说话爱引用诗句', '走路总靠着墙边', '睡前一定要把窗留条缝', '随身带一本写满批注的旧书', '遇到难题会先沉默十秒', '爱给身边的小动物起名字'],
    秘密: ['其实一直在找一个失散多年的人', '背着一笔没说出口的旧债', '会一点从不示人的本事', '对某个人怀着没说出口的愧疚', '梦里总是同一个地方', '藏着一封一直没寄出去的信'],
    关系: ['和对方是多年的邻居', '对方曾在最难的时候帮过自己', '两人因一桩旧案被迫同行', '对方是自己唯一信任的人', '刚认识，但彼此都觉得似曾相识', '是对方名义上的学生或下属'],
};

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomIdea() {
    return [pick(SEEDS.身份), pick(SEEDS.性格), pick(SEEDS.外貌), pick(SEEDS.小习惯), pick(SEEDS.秘密), '与{{char}}的关系：' + pick(SEEDS.关系)].join('；');
}

const TEMPLATE_MAIN = `name:
  Chinese name:
  Nickname:
  age:
  birthday:
  gender:
  height:
  identity:
    -
  background_story:
    童年(0-12岁):
    少年(13-18岁):
    青年(19-35岁):
    中年(35-至今):
    现状:

  social_status:
    -

  appearance:
    hair:
    eyes:
    skin:
    face_style:
    build:
      -
  attire:
    business_formal:
    business_casual:
    casual_wear:
    home_wear:

  archetype:

  personality:
    core_traits:
      - 词语概念: "具体行为与表现的详细说明"
    romantic_traits:
      - 词语概念: "具体行为与表现的详细说明"

  lifestyle_behaviors:
    -

  work_behaviors:
    -

  emotional_behaviors:
    angry:
    happy:

  goals:
    -

  weakness:
    -

  likes:
    -

  dislikes:
    -

  skills:
    - 工作: ["", ""]
    - 生活: ["", ""]
    - 爱好: ["", ""]`;

const TEMPLATE_NSFW = `

  NSFW_information:
    Sex_related traits:
      experiences:
      sexual_orientation:
      sexual_role:
      sexual_habits:
        -
    Kinks:
    Limits:`;

const FIELD_NOTES = [
    'archetype 填便于 AI 理解的概括性文学形象（如花花公子、傲娇、魅力型操控者），作为个性代表或补充，作用类似 tag。',
    'personality 不一定要是「核心个性 + 浪漫个性」两组：按角色在不同重要状态下的主导面拆开，每条用「个性词语概念: "行为的详细说明"」的形式，把角色的一些行为融进引号里的说明。',
    '个性是词语概念，行为是详细说明，两者分开写。',
];

function clip(text, max) {
    const s = String(text ?? '').trim();
    return s.length > max ? s.slice(0, max) + '…（已截断）' : s;
}

// 取酒馆当前真正生效的世界书条目：全局 + 角色 + 聊天 + 人设绑定的世界书，只留「开启」的条目（常驻条目排前面）
async function getActiveLoreEntries(ctx, ch) {
    let entries = [];
    try {
        const mod = await import('../../../world-info.js');
        if (typeof mod.getSortedEntries === 'function') {
            entries = await mod.getSortedEntries();
        }
    } catch (e) {
        console.warn(`[${MODULE}] 读取世界书总览失败，改读角色绑定的世界书`, e);
    }
    if (!entries.length) {
        // 兜底：只读角色绑定的 / 内嵌的世界书
        let book = null;
        const linked = ch?.data?.extensions?.world;
        if (linked && typeof ctx.loadWorldInfo === 'function') {
            try { book = await ctx.loadWorldInfo(linked); } catch (e) { console.warn(`[${MODULE}] 读取世界书失败`, e); }
        }
        if (!book && ch?.data?.character_book) book = ch.data.character_book;
        const raw = book?.entries ?? {};
        entries = Array.isArray(raw) ? raw : Object.values(raw);
    }
    const enabled = entries.filter((e) => e && !e.disable && e.enabled !== false);
    // 常驻（constant）条目优先
    return enabled.sort((a, b) => Number(!!b.constant) - Number(!!a.constant));
}

// 读取当前聊天角色的人设 / 世界书 / 开场白，字数受 limit 控制（省 token）
async function gatherCharContext({ useCard, useLore, useGreeting, limit }) {
    const ctx = getContext();
    if (ctx.groupId) {
        throw new Error('当前是群聊，暂不支持读取角色卡，请先进入单人角色的聊天');
    }
    const chid = ctx.characterId;
    const ch = chid === undefined || chid === null ? null : ctx.characters?.[chid];
    if (!ch) {
        throw new Error('没有选中角色卡，请先打开一个角色的聊天');
    }
    const parts = [`角色名：${ch.name || '(未命名)'}`];

    if (useCard) {
        const card = [
            ch.description && `描述：${clip(ch.description, Math.floor(limit * 0.8))}`,
            ch.personality && `性格：${clip(ch.personality, 300)}`,
            ch.scenario && `场景设定：${clip(ch.scenario, 500)}`,
        ].filter(Boolean);
        if (card.length) parts.push('【角色人设】\n' + card.join('\n'));
    }

    if (useGreeting) {
        // 优先读当前聊天里真正的第一条角色消息（包含你选的 swipe / 改过的开场白），读不到再用角色卡里的
        const firstInChat = (ctx.chat || []).find((m) => m && !m.is_user && !m.is_system);
        const first = firstInChat?.mes || ch.first_mes || ch.data?.first_mes;
        if (first) parts.push('【开场白】\n' + clip(first, 800));
    }

    if (useLore) {
        const entries = await getActiveLoreEntries(ctx, ch);
        const lines = [];
        let used = 0;
        for (const e of entries) {
            const title = e.comment || (Array.isArray(e.key) ? e.key.join('/') : e.keys?.join?.('/')) || '条目';
            const body = clip(e.content, 400);
            if (!body) continue;
            const line = `- ${title}：${body}`;
            if (used + line.length > limit) break;
            lines.push(line);
            used += line.length;
        }
        if (lines.length) parts.push(`【世界书（只含已开启的条目，共 ${entries.length} 条，按字数上限截取）】\n` + lines.join('\n'));
    }

    return parts.length > 1 ? parts.join('\n\n') : '';
}

function buildPrompt(keywords, name, detail, withNsfw, charContext) {
    const who = name ? `角色中文名叫「${name}」` : '角色名字由你合适地起一个';
    const depth = detail === 'brief' ? '每个字段写得简短（一句话以内）' : detail === 'rich' ? '每个字段写得充实具体，背景故事各阶段写 2~3 句' : '每个字段写得适中，背景故事各阶段写 1~2 句';
    const template = TEMPLATE_MAIN + (withNsfw ? TEMPLATE_NSFW : '');
    return [
        '你是一位擅长为角色扮演写角色设定的编辑。请根据下面的关键词，为一位「用户角色」（user persona）写一份设定，必须严格使用给定的格式，保留全部字段名和缩进，把空字段填满。',
        `要求：${who}；${depth}；语言用中文（字段名保持原样）；设定要具体、有故事感，不空泛，前后自洽；只输出填好的格式本身，不要写前言、解释或代码块标记。`,
        '写作说明（来自使用者的习惯）：',
        ...FIELD_NOTES.map((s) => '- ' + s),
        ...(charContext ? [
            '下面是要和这位用户角色互动的 {{char}} 的参考资料。请让用户角色的时代、世界观、语言风格与之自洽，并留出能与 {{char}} 发生关系、推动剧情的空间；不要照抄资料里的内容，也不要把 {{char}} 当成用户角色本人：',
            charContext,
        ] : []),
        `关键词：${keywords || '（无，请自由发挥，写一位有故事感的人）'}`,
        '格式如下：',
        template,
    ].join('\n');
}

async function generateWithAI(prompt) {
    const ctx = getContext();
    const fn = ctx.generateRaw;
    if (typeof fn !== 'function') {
        throw new Error('当前酒馆版本没有 generateRaw');
    }
    // 新版接收对象参数（函数长度为 0），旧版是位置参数
    const text = fn.length === 0 ? await fn({ prompt }) : await fn(prompt, null, false);
    return String(text ?? '').trim();
}

function applyToPersona(text) {
    const box = document.querySelector('#persona_description');
    if (!box) {
        throw new Error('没有找到人设描述输入框，请先打开一次「用户设置 / Persona」面板再试');
    }
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
}

function toast(kind, msg) {
    if (window.toastr && window.toastr[kind]) {
        window.toastr[kind](msg, 'Persona Forge');
    } else {
        console.log(`[${MODULE}]`, msg);
    }
}

function panelHtml() {
    return `
<div class="inline-drawer" id="pf_root">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>Persona Forge 人设生成器</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <div class="pf-block">
      <label for="pf_name">称呼（可留空）</label>
      <input id="pf_name" type="text" class="text_pole" placeholder="比如：沈砚、小林…">
      <label for="pf_keywords">关键词（可留空，点「随机灵感」自动填）</label>
      <textarea id="pf_keywords" class="text_pole" placeholder="比如：落魄的江湖郎中；嘴硬心软；手腕有旧疤"></textarea>
      <div class="pf-row">
        <select id="pf_detail" class="text_pole"><option value="brief">简短</option><option value="normal" selected>适中</option><option value="rich">详细</option></select>
      </div>
      <label class="checkbox_label"><input id="pf_nsfw" type="checkbox" checked><span>包含 NSFW_information 段（按你的格式，不需要就取消勾选）</span></label>
      <div class="pf-hint">参考当前聊天的角色（让人设和 char 自洽）：</div>
      <label class="checkbox_label"><input id="pf_use_card" type="checkbox"><span>读 char 人设</span></label>
      <label class="checkbox_label"><input id="pf_use_lore" type="checkbox"><span>读世界书</span></label>
      <label class="checkbox_label"><input id="pf_use_greeting" type="checkbox"><span>读开场白</span></label>
      <label for="pf_limit">参考资料字数上限（越大越费 token）</label>
      <input id="pf_limit" type="number" class="text_pole" min="500" max="12000" step="500" value="3000">
      <div class="pf-row">
        <div id="pf_random" class="menu_button">随机灵感</div>
        <div id="pf_generate" class="menu_button">AI 生成</div>
      </div>
      <label for="pf_output">结果（可以直接改）</label>
      <textarea id="pf_output" class="text_pole" style="min-height:160px"></textarea>
      <div class="pf-row">
        <div id="pf_apply" class="menu_button">应用到当前人设</div>
        <div id="pf_copy" class="menu_button">复制</div>
      </div>
      <div class="pf-hint">「AI 生成」会用你当前连接的模型。「应用」会把结果写进当前 Persona 的描述框，别忘了在酒馆里确认保存。</div>
    </div>
  </div>
</div>`;
}

function mount() {
    const host = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (!host) {
        console.warn(`[${MODULE}] 找不到扩展面板容器`);
        return;
    }
    if (document.querySelector('#pf_root')) {
        return;
    }
    host.insertAdjacentHTML('beforeend', panelHtml());

    const $ = (id) => document.getElementById(id);

    $('pf_random').addEventListener('click', () => {
        $('pf_keywords').value = randomIdea();
    });

    $('pf_generate').addEventListener('click', async () => {
        const btn = $('pf_generate');
        if (btn.dataset.busy) {
            return;
        }
        btn.dataset.busy = '1';
        const old = btn.textContent;
        btn.textContent = '生成中…';
        try {
            const useCard = $('pf_use_card').checked;
            const useLore = $('pf_use_lore').checked;
            const useGreeting = $('pf_use_greeting').checked;
            const limit = Math.max(500, Math.min(12000, Number($('pf_limit').value) || 3000));
            const charContext = (useCard || useLore || useGreeting)
                ? await gatherCharContext({ useCard, useLore, useGreeting, limit })
                : '';
            const prompt = buildPrompt($('pf_keywords').value.trim(), $('pf_name').value.trim(), $('pf_detail').value, $('pf_nsfw').checked, charContext);
            const text = await generateWithAI(prompt);
            if (!text) {
                throw new Error('模型没有返回内容，请检查是否已连接 API');
            }
            $('pf_output').value = text;
        } catch (e) {
            console.error(`[${MODULE}]`, e);
            toast('error', e.message || String(e));
        } finally {
            delete btn.dataset.busy;
            btn.textContent = old;
        }
    });

    $('pf_apply').addEventListener('click', () => {
        const text = $('pf_output').value.trim();
        if (!text) {
            toast('warning', '结果是空的');
            return;
        }
        try {
            applyToPersona(text);
            toast('success', '已写进当前人设的描述框');
        } catch (e) {
            toast('error', e.message || String(e));
        }
    });

    $('pf_copy').addEventListener('click', async () => {
        const text = $('pf_output').value;
        if (!text) {
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            toast('success', '已复制');
        } catch {
            $('pf_output').select();
            toast('info', '请手动长按复制');
        }
    });
}

jQuery(() => {
    mount();
});
