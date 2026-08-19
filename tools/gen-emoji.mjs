// 从 emoji-datasource 的 emoji.json 生成 EasyTool 需要的精简数据。
// 用法: node tools/gen-emoji.mjs <input.json> <output.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const raw = JSON.parse(readFileSync(input, "utf8"));

// 官方分类 → 内部 group id + 中文名
const GROUP_MAP = {
  "Smileys & Emotion": ["smileys", "笑脸"],
  "People & Body": ["people", "人物"],
  "Animals & Nature": ["animals", "动物"],
  "Food & Drink": ["food", "食物"],
  "Travel & Places": ["travel", "旅行"],
  "Activities": ["activities", "活动"],
  "Objects": ["objects", "物品"],
  "Symbols": ["symbols", "符号"],
  "Flags": ["flags", "旗帜"],
};

// 高频中文关键词（覆盖常用搜索词；未覆盖的回退英文 shortcode）
const ZH_HINTS = {
  grinning: ["笑脸", "笑"], smile: ["微笑", "笑"], joy: ["笑哭", "大笑"],
  heart: ["爱心", "心"], crying: ["哭", "哭脸"], thumbsup: ["赞", "好", "大拇指"],
  clap: ["鼓掌", "拍手"], fire: ["火", "热门"], star: ["星星", "星"], sun: ["太阳"],
  moon: ["月亮"], cat: ["猫"], dog: ["狗"], flower: ["花"], gift: ["礼物", "礼物盒"],
  birthday: ["生日", "蛋糕"], rocket: ["火箭", "冲"], ok_hand: ["好", "可以"],
  prayer: ["祈祷", "拜托"], wave: ["挥手", "再见"], thinking: ["思考", "想"],
  party: ["派对", "庆祝"], check: ["对", "勾"], cross: ["错", "叉"],
  question: ["问", "问号"], exclamation: ["叹号", "注意"], lock: ["锁"], key: ["钥匙"],
  phone: ["电话", "手机"], computer: ["电脑", "笔记本"], book: ["书", "书本"],
  coffee: ["咖啡"], beer: ["啤酒", "干杯"], apple: ["苹果"], banana: ["香蕉"],
  snowman: ["雪人", "雪"], rain: ["雨", "下雨"], cloud: ["云", "多云"],
  zap: ["闪电", "电"], snowflake: ["雪花"], car: ["车", "汽车"],
  airplane: ["飞机", "飞"], ship: ["船"], bicycle: ["自行车", "单车"],
  watch: ["手表", "表"], clock: ["时钟", "时间"], calendar: ["日历", "日期"],
  envelope: ["邮件", "信"], bell: ["铃铛", "提醒"], pencil: ["铅笔", "笔"],
  scissors: ["剪刀"], hammer: ["锤子"], lightbulb: ["灯泡", "灵感", "想法"],
  gear: ["齿轮", "设置"], battery: ["电池"], warning: ["警告", "注意"],
  info: ["信息", "提示"], recycle: ["回收", "环保"], flag: ["旗帜", "旗"],
  cn: ["中国", "国旗"], us: ["美国", "国旗"], jp: ["日本", "国旗"],
  video: ["视频", "电影"], music: ["音乐", "歌"], game: ["游戏", "手柄"],
  ball: ["球", "运动"], trophy: ["奖杯", "冠军"], medal: ["奖牌", "奖"],
  money: ["钱", "金钱", "财富"], bank: ["银行", "钱"], gem: ["宝石", "钻石"],
  boom: ["爆炸", "震惊"], ghost: ["鬼", "幽灵"], skull: ["骷髅", "死"],
  alien: ["外星人"], robot: ["机器人"], monkey: ["猴子", "猴"], pig: ["猪"],
  chicken: ["鸡"], bird: ["鸟", "小鸟"], fish: ["鱼"], bee: ["蜜蜂", "蜂"],
  butterfly: ["蝴蝶"], turtle: ["乌龟"], snake: ["蛇"], dragon: ["龙", "龙年"],
  horse: ["马"], rabbit: ["兔子", "兔"], tiger: ["老虎", "虎"], bear: ["熊"],
  panda: ["熊猫"], penguin: ["企鹅"], frog: ["青蛙"], owl: ["猫头鹰"],
  fox: ["狐狸"], wolf: ["狼"], koala: ["考拉", "树袋熊"], lion: ["狮子", "狮"],
  elephant: ["大象"], giraffe: ["长颈鹿"], zebra: ["斑马"], camel: ["骆驼"],
  spider: ["蜘蛛"], bug: ["虫子", "虫"], ant: ["蚂蚁"], snail: ["蜗牛"],
  eggplant: ["茄子"], tomato: ["西红柿", "番茄"], corn: ["玉米"],
  watermelon: ["西瓜"], grapes: ["葡萄"], cherry: ["樱桃", "车厘子"],
  peach: ["桃子"], strawberry: ["草莓"], lemon: ["柠檬"], pineapple: ["菠萝"],
  coconut: ["椰子"], pizza: ["披萨", "比萨"], burger: ["汉堡", "汉堡包"],
  fries: ["薯条", "炸薯条"], hotdog: ["热狗"], taco: ["卷饼", "塔可"],
  donut: ["甜甜圈", "面包圈"], cake: ["蛋糕", "甜点"], cookie: ["曲奇", "饼干"],
  candy: ["糖果", "糖"], icecream: ["冰淇淋", "雪糕"],
  chocolate: ["巧克力", "巧克力豆"], tea: ["茶", "喝茶"], milk: ["牛奶", "奶"],
  juice: ["果汁", "饮料"], champagne: ["香槟", "干杯"], cocktail: ["鸡尾酒", "酒"],
  soccer: ["足球", "球赛"], basketball: ["篮球", "球"], baseball: ["棒球"],
  tennis: ["网球"], golf: ["高尔夫"], swim: ["游泳", "游泳运动"],
  run: ["跑步", "跑"], sleep: ["睡觉", "睡", "困"], dizzy: ["晕", "晕头"],
  sweat: ["汗", "出汗"], angry: ["生气", "愤怒", "怒"], rage: ["生气", "愤怒"],
  scream: ["尖叫", "喊"], kiss: ["亲亲", "亲吻", "亲"], love: ["爱", "喜欢"],
  wink: ["眨眼", "放电"], blush: ["害羞", "脸红"], hush: ["嘘", "安静"],
  sick: ["生病", "病", "难受"], nauseated: ["恶心", "想吐"], mask: ["口罩", "防护"],
  sunglasses: ["墨镜", "太阳镜", "酷"], crown: ["皇冠", "王冠", "国王"],
  sparkles: ["闪光", "闪闪", "闪耀"], star2: ["星光", "闪亮", "闪耀"],
};

function toChar(unified) {
  // unified 形如 "1F600" 或 "1F1E8 1F1F3"（多个码位用空格分隔）
  return unified.split(" ").map((h) => String.fromCodePoint(parseInt(h, 16))).join("");
}

const groups = new Set(Object.keys(GROUP_MAP));
const out = { emoji: [] };
for (const e of raw) {
  if (!groups.has(e.category)) continue; // 过滤 Component 等非完整表情
  const [group, groupZh] = GROUP_MAP[e.category];
  const keywords = [...new Set([e.short_name, ...(e.short_names || [])])];
  const zh = ZH_HINTS[e.short_name] || [];
  const nameEn = (e.name || "").toLowerCase().replace(/_/g, " ");
  out.emoji.push({
    char: toChar(e.unified),
    group,
    group_zh: groupZh,
    name_en: nameEn,
    keywords,
    keywords_zh: zh,
  });
}
out.emoji.sort((a, b) => a.keywords[0].localeCompare(b.keywords[0]));
writeFileSync(output, JSON.stringify(out));
console.log(`generated ${out.emoji.length} emoji -> ${output}`);
