'use strict';
/* ================= 词典内置数据（离线兜底：主题词表 + 中文含义反查） ================= */
window.DICT_DATA = {

  themes: [
    { key: 'animals', name: '🐾 动物', words: 'cat猫,dog狗,bird鸟,fish鱼,horse马,cow奶牛,pig猪,sheep绵羊,rabbit兔子,tiger老虎,lion狮子,elephant大象,panda熊猫,monkey猴子,duck鸭子' },
    { key: 'food', name: '🍎 食物水果', words: 'apple苹果,banana香蕉,orange橙子,grape葡萄,watermelon西瓜,rice米饭,noodle面条,bread面包,egg鸡蛋,milk牛奶,tea茶,coffee咖啡,juice果汁,cake蛋糕,meat肉' },
    { key: 'school', name: '🏫 学校', words: 'book书,pen钢笔,pencil铅笔,desk书桌,chair椅子,classroom教室,teacher老师,student学生,lesson课,homework作业,exam考试,library图书馆,schoolbag书包,ruler尺子,eraser橡皮' },
    { key: 'family', name: '👨‍👩‍👧 家庭', words: 'father爸爸,mother妈妈,brother兄弟,sister姐妹,grandpa爷爷,grandma奶奶,uncle叔叔,aunt阿姨,son儿子,daughter女儿,parent父母,family家庭,baby宝宝,cousin堂表亲,husband丈夫' },
    { key: 'colors', name: '🎨 颜色', words: 'red红色,blue蓝色,green绿色,yellow黄色,black黑色,white白色,pink粉色,purple紫色,orange橙色,brown棕色,grey灰色,gold金色,silver银色,color颜色,rainbow彩虹' },
    { key: 'body', name: '🧍 身体', words: 'head头,hair头发,face脸,eye眼睛,ear耳朵,nose鼻子,mouth嘴巴,tooth牙齿,hand手,arm手臂,leg腿,foot脚,heart心,shoulder肩膀,knee膝盖' },
    { key: 'weather', name: '⛅ 天气', words: 'sunny晴朗的,rainy下雨的,cloudy多云的,windy有风的,snowy下雪的,hot热的,cold冷的,warm温暖的,cool凉爽的,weather天气,rain雨,snow雪,wind风,storm暴风雨,temperature温度' },
    { key: 'transport', name: '🚗 交通', words: 'car小汽车,bus公共汽车,train火车,plane飞机,ship轮船,bike自行车,subway地铁,taxi出租车,truck卡车,boat小船,road路,station车站,airport机场,ticket票,drive驾驶' },
    { key: 'jobs', name: '💼 职业', words: 'doctor医生,nurse护士,teacher老师,farmer农民,driver司机,cook厨师,worker工人,writer作家,singer歌手,actor演员,artist画家,scientist科学家,police警察,engineer工程师,waiter服务员' },
    { key: 'feelings', name: '😊 情绪', words: 'happy开心的,sad悲伤的,angry生气的,afraid害怕的,surprised惊讶的,tired疲倦的,excited兴奋的,nervous紧张的,proud自豪的,lonely孤独的,calm冷静的,shy害羞的,mood心情,feel感觉,relax放松' },
    { key: 'sports', name: '⚽ 运动', words: 'football足球,basketball篮球,tennis网球,swim游泳,run跑,jump跳,ride骑,gym体育馆,team队伍,match比赛,player运动员,coach教练,sport运动,exercise锻炼,race赛跑' },
    { key: 'home', name: '🏠 家居', words: 'room房间,kitchen厨房,bathroom浴室,bedroom卧室,living room客厅,door门,window窗户,table桌子,bed床,sofa沙发,lamp台灯,fridge冰箱,TV电视,computer电脑,phone手机' }
  ]
};

/* 由主题词表生成 中文→英文 反查索引（离线用） */
window.DICT_DATA.zhIndex = (function () {
  const idx = {};
  for (const t of window.DICT_DATA.themes) {
    for (const pair of t.words.split(',')) {
      const i = pair.search(/[一-鿿]/);
      if (i <= 0) continue;
      const en = pair.slice(0, i).trim();
      const zh = pair.slice(i).trim();
      if (!en) continue;
      if (!idx[zh]) idx[zh] = [];
      idx[zh].push({ en, zh, ex: '' });
      // 双字词做包含匹配用（如 "水果" 能命中 "苹果"？不能，这里只建精确+前缀）
    }
  }
  return idx;
})();
