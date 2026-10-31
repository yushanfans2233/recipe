import type { ImageMetadata } from 'astro';
import cover from '../assets/recipes/白灼菜心.webp';

export interface FactRow {
  name: string;
  amount: string;
}

export interface FactGroup {
  /** 分组小标题，如 料汁 / 焯水 */
  title?: string;
  rows: FactRow[];
}

export interface Step {
  label: string;
  time?: string;
  items: string[];
}

export interface DemoRecipe {
  title: string;
  category: string;
  photo?: ImageMetadata;
  /** 主食材 */
  ingredients: FactRow[];
  /** 调味，可能含多个小分组 */
  seasoning: FactGroup[];
  steps: Step[];
  tips: string[];
}

export const demoRecipe: DemoRecipe = {
  title: '白灼菜心',
  category: '蔬菜',
  photo: cover,
  ingredients: [
    { name: '菜心', amount: '500g' },
    { name: '大蒜', amount: '20g（4瓣）' },
    { name: '洋葱', amount: '20g' },
    { name: '大葱', amount: '10g' },
  ],
  seasoning: [
    {
      title: '料汁',
      rows: [
        { name: '生抽', amount: '4勺（约40g）' },
        { name: '白糖', amount: '1~2勺（约7g）' },
        { name: '鸡精', amount: '1勺' },
        { name: '蚝油', amount: '半勺' },
        { name: '清水', amount: '3勺（另备）' },
      ],
    },
    {
      title: '焯水',
      rows: [
        { name: '食用油', amount: '适量' },
        { name: '盐', amount: '1勺' },
        { name: '高度白酒（可选）', amount: '半勺' },
      ],
    },
  ],
  steps: [
    {
      label: '备菜',
      time: '10min',
      items: [
        '处理菜心：摘除菜心老叶，保留嫩叶；用指甲掐试茎部，掐不动则用削皮刀削去外皮，清理干净后洗净备用。',
        '制备小料：大蒜切蒜末，洋葱切细丁；大葱取外层 4 层外皮斜切葱丝，红辣椒去籽切丝备用。',
        '调配基础料汁：混合料汁，单独备好 3 勺清水备用。',
      ],
    },
    {
      label: '焯烫菜心',
      time: '2min',
      items: [
        '锅中加半锅清水，放入 1 勺盐、1 勺食用油，可加入半勺高度白酒。',
        '大火将水烧开，码齐菜心梗先下锅烫十几秒，再将整根菜心全部下入锅中。',
        '全程焯烫 1 分钟，到点后立即关火捞出，过凉水降温，控干水分后整齐码入盘中。',
      ],
    },
    {
      label: '熬制白灼汁 & 装盘',
      time: '5min',
      items: [
        '热锅凉油，下入蒜末、洋葱末，开中小火慢炒。',
        '炒至 20% 蒜末呈金黄色时，立刻转最小火，避免小料炒苦。',
        '保持最小火，倒入提前调好的料汁搅拌至冒泡，加入备好的 3 勺清水。',
        '调大火将汤汁煮沸，即刻关火，将熬好的白灼汁均匀淋在菜心上即可。',
      ],
    },
  ],
  tips: [
    '白灼汁加少量洋葱丁，比单纯用蒜末更香，是提升风味的关键技巧。',
    '焯菜加盐可让菜心色泽翠绿，加食用油能提亮颜色，少许白酒可增脆锁鲜。',
    '菜心焯烫严格控制 1 分钟，超时容易软烂，过凉水是保持脆嫩口感的核心步骤。',
    '炒蒜料一定要把控火候，蒜末少量金黄即刻转小火，炒苦会毁掉整道菜品味道。',
    '不喜甜食可将白糖减量至 1 勺，适配清淡口味。',
  ],
};
