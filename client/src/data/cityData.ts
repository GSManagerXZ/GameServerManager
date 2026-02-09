/**
 * 城市数据模块
 * 包含中国所有地级市及以上城市的代码数据
 * 城市代码使用中国天气网编码体系：格式 101XXYYZZ（9位数字，101开头）
 */

// 城市数据项接口
export interface CityOption {
  value: string    // 城市代码，如 '101010100'
  label: string    // 城市名称，如 '北京市'
  province: string // 所属省份，如 '北京'
}

// 完整城市列表（按省份分组排列）
export const cityOptions: CityOption[] = [
  // ==================== 直辖市 ====================

  // 北京
  { value: '101010100', label: '北京市', province: '北京' },

  // 天津
  { value: '101030100', label: '天津市', province: '天津' },

  // 上海
  { value: '101020100', label: '上海市', province: '上海' },

  // 重庆
  { value: '101040100', label: '重庆市', province: '重庆' },

  // ==================== 河北省 ====================
  { value: '101090101', label: '石家庄市', province: '河北' },
  { value: '101090201', label: '保定市', province: '河北' },
  { value: '101090301', label: '张家口市', province: '河北' },
  { value: '101090401', label: '承德市', province: '河北' },
  { value: '101090501', label: '唐山市', province: '河北' },
  { value: '101090601', label: '廊坊市', province: '河北' },
  { value: '101090701', label: '沧州市', province: '河北' },
  { value: '101090801', label: '衡水市', province: '河北' },
  { value: '101090901', label: '邢台市', province: '河北' },
  { value: '101091001', label: '邯郸市', province: '河北' },
  { value: '101091101', label: '秦皇岛市', province: '河北' },

  // ==================== 山西省 ====================
  { value: '101100101', label: '太原市', province: '山西' },
  { value: '101100201', label: '大同市', province: '山西' },
  { value: '101100301', label: '阳泉市', province: '山西' },
  { value: '101100401', label: '晋中市', province: '山西' },
  { value: '101100501', label: '长治市', province: '山西' },
  { value: '101100601', label: '晋城市', province: '山西' },
  { value: '101100701', label: '临汾市', province: '山西' },
  { value: '101100801', label: '运城市', province: '山西' },
  { value: '101100901', label: '朔州市', province: '山西' },
  { value: '101101001', label: '忻州市', province: '山西' },
  { value: '101101100', label: '吕梁市', province: '山西' },

  // ==================== 内蒙古自治区 ====================
  { value: '101080101', label: '呼和浩特市', province: '内蒙古' },
  { value: '101080201', label: '包头市', province: '内蒙古' },
  { value: '101080301', label: '乌海市', province: '内蒙古' },
  { value: '101080401', label: '乌兰察布市', province: '内蒙古' },
  { value: '101080501', label: '通辽市', province: '内蒙古' },
  { value: '101080601', label: '赤峰市', province: '内蒙古' },
  { value: '101080701', label: '鄂尔多斯市', province: '内蒙古' },
  { value: '101080801', label: '巴彦淖尔市', province: '内蒙古' },
  { value: '101080901', label: '锡林郭勒盟', province: '内蒙古' },
  { value: '101081001', label: '呼伦贝尔市', province: '内蒙古' },
  { value: '101081101', label: '兴安盟', province: '内蒙古' },
  { value: '101081201', label: '阿拉善盟', province: '内蒙古' },

  // ==================== 辽宁省 ====================
  { value: '101070101', label: '沈阳市', province: '辽宁' },
  { value: '101070201', label: '大连市', province: '辽宁' },
  { value: '101070301', label: '鞍山市', province: '辽宁' },
  { value: '101070401', label: '抚顺市', province: '辽宁' },
  { value: '101070501', label: '本溪市', province: '辽宁' },
  { value: '101070601', label: '丹东市', province: '辽宁' },
  { value: '101070701', label: '锦州市', province: '辽宁' },
  { value: '101070801', label: '营口市', province: '辽宁' },
  { value: '101070901', label: '阜新市', province: '辽宁' },
  { value: '101071001', label: '辽阳市', province: '辽宁' },
  { value: '101071101', label: '铁岭市', province: '辽宁' },
  { value: '101071201', label: '朝阳市', province: '辽宁' },
  { value: '101071301', label: '盘锦市', province: '辽宁' },
  { value: '101071401', label: '葫芦岛市', province: '辽宁' },

  // ==================== 吉林省 ====================
  { value: '101060101', label: '长春市', province: '吉林' },
  { value: '101060201', label: '吉林市', province: '吉林' },
  { value: '101060301', label: '延边朝鲜族自治州', province: '吉林' },
  { value: '101060401', label: '四平市', province: '吉林' },
  { value: '101060501', label: '通化市', province: '吉林' },
  { value: '101060601', label: '白城市', province: '吉林' },
  { value: '101060701', label: '辽源市', province: '吉林' },
  { value: '101060801', label: '松原市', province: '吉林' },
  { value: '101060901', label: '白山市', province: '吉林' },

  // ==================== 黑龙江省 ====================
  { value: '101050101', label: '哈尔滨市', province: '黑龙江' },
  { value: '101050201', label: '齐齐哈尔市', province: '黑龙江' },
  { value: '101050301', label: '牡丹江市', province: '黑龙江' },
  { value: '101050401', label: '佳木斯市', province: '黑龙江' },
  { value: '101050501', label: '大庆市', province: '黑龙江' },
  { value: '101050601', label: '绥化市', province: '黑龙江' },
  { value: '101050701', label: '鹤岗市', province: '黑龙江' },
  { value: '101050801', label: '鸡西市', province: '黑龙江' },
  { value: '101050901', label: '黑河市', province: '黑龙江' },
  { value: '101051001', label: '双鸭山市', province: '黑龙江' },
  { value: '101051002', label: '伊春市', province: '黑龙江' },
  { value: '101051101', label: '七台河市', province: '黑龙江' },
  { value: '101051301', label: '大兴安岭地区', province: '黑龙江' },

  // ==================== 江苏省 ====================
  { value: '101190101', label: '南京市', province: '江苏' },
  { value: '101190201', label: '无锡市', province: '江苏' },
  { value: '101190301', label: '镇江市', province: '江苏' },
  { value: '101190401', label: '苏州市', province: '江苏' },
  { value: '101190501', label: '南通市', province: '江苏' },
  { value: '101190601', label: '扬州市', province: '江苏' },
  { value: '101190701', label: '盐城市', province: '江苏' },
  { value: '101190801', label: '徐州市', province: '江苏' },
  { value: '101190901', label: '淮安市', province: '江苏' },
  { value: '101191001', label: '连云港市', province: '江苏' },
  { value: '101191101', label: '常州市', province: '江苏' },
  { value: '101191201', label: '泰州市', province: '江苏' },
  { value: '101191301', label: '宿迁市', province: '江苏' },

  // ==================== 浙江省 ====================
  { value: '101210101', label: '杭州市', province: '浙江' },
  { value: '101210201', label: '湖州市', province: '浙江' },
  { value: '101210301', label: '嘉兴市', province: '浙江' },
  { value: '101210401', label: '宁波市', province: '浙江' },
  { value: '101210501', label: '绍兴市', province: '浙江' },
  { value: '101210601', label: '台州市', province: '浙江' },
  { value: '101210701', label: '温州市', province: '浙江' },
  { value: '101210801', label: '丽水市', province: '浙江' },
  { value: '101210901', label: '金华市', province: '浙江' },
  { value: '101211001', label: '衢州市', province: '浙江' },
  { value: '101211101', label: '舟山市', province: '浙江' },

  // ==================== 安徽省 ====================
  { value: '101220101', label: '合肥市', province: '安徽' },
  { value: '101220201', label: '蚌埠市', province: '安徽' },
  { value: '101220301', label: '芜湖市', province: '安徽' },
  { value: '101220401', label: '淮南市', province: '安徽' },
  { value: '101220501', label: '马鞍山市', province: '安徽' },
  { value: '101220601', label: '安庆市', province: '安徽' },
  { value: '101220701', label: '宿州市', province: '安徽' },
  { value: '101220801', label: '阜阳市', province: '安徽' },
  { value: '101220901', label: '亳州市', province: '安徽' },
  { value: '101221001', label: '黄山市', province: '安徽' },
  { value: '101221101', label: '滁州市', province: '安徽' },
  { value: '101221201', label: '淮北市', province: '安徽' },
  { value: '101221301', label: '铜陵市', province: '安徽' },
  { value: '101221401', label: '宣城市', province: '安徽' },
  { value: '101221501', label: '六安市', province: '安徽' },
  { value: '101221601', label: '池州市', province: '安徽' },

  // ==================== 福建省 ====================
  { value: '101230101', label: '福州市', province: '福建' },
  { value: '101230201', label: '厦门市', province: '福建' },
  { value: '101230301', label: '宁德市', province: '福建' },
  { value: '101230401', label: '莆田市', province: '福建' },
  { value: '101230501', label: '泉州市', province: '福建' },
  { value: '101230601', label: '漳州市', province: '福建' },
  { value: '101230701', label: '龙岩市', province: '福建' },
  { value: '101230801', label: '三明市', province: '福建' },
  { value: '101230901', label: '南平市', province: '福建' },

  // ==================== 江西省 ====================
  { value: '101240101', label: '南昌市', province: '江西' },
  { value: '101240201', label: '九江市', province: '江西' },
  { value: '101240301', label: '景德镇市', province: '江西' },
  { value: '101240401', label: '上饶市', province: '江西' },
  { value: '101240501', label: '抚州市', province: '江西' },
  { value: '101240601', label: '新余市', province: '江西' },
  { value: '101240701', label: '宜春市', province: '江西' },
  { value: '101240801', label: '吉安市', province: '江西' },
  { value: '101240901', label: '赣州市', province: '江西' },
  { value: '101241001', label: '萍乡市', province: '江西' },
  { value: '101241101', label: '鹰潭市', province: '江西' },

  // ==================== 山东省 ====================
  { value: '101120101', label: '济南市', province: '山东' },
  { value: '101120201', label: '青岛市', province: '山东' },
  { value: '101120301', label: '淄博市', province: '山东' },
  { value: '101120401', label: '德州市', province: '山东' },
  { value: '101120501', label: '烟台市', province: '山东' },
  { value: '101120601', label: '潍坊市', province: '山东' },
  { value: '101120701', label: '济宁市', province: '山东' },
  { value: '101120801', label: '泰安市', province: '山东' },
  { value: '101120901', label: '临沂市', province: '山东' },
  { value: '101121001', label: '菏泽市', province: '山东' },
  { value: '101121101', label: '滨州市', province: '山东' },
  { value: '101121201', label: '东营市', province: '山东' },
  { value: '101121301', label: '威海市', province: '山东' },
  { value: '101121401', label: '枣庄市', province: '山东' },
  { value: '101121501', label: '日照市', province: '山东' },
  { value: '101121601', label: '聊城市', province: '山东' },

  // ==================== 河南省 ====================
  { value: '101180101', label: '郑州市', province: '河南' },
  { value: '101180201', label: '安阳市', province: '河南' },
  { value: '101180301', label: '新乡市', province: '河南' },
  { value: '101180401', label: '许昌市', province: '河南' },
  { value: '101180501', label: '平顶山市', province: '河南' },
  { value: '101180601', label: '信阳市', province: '河南' },
  { value: '101180701', label: '南阳市', province: '河南' },
  { value: '101180801', label: '开封市', province: '河南' },
  { value: '101180901', label: '洛阳市', province: '河南' },
  { value: '101181001', label: '商丘市', province: '河南' },
  { value: '101181101', label: '焦作市', province: '河南' },
  { value: '101181201', label: '鹤壁市', province: '河南' },
  { value: '101181301', label: '濮阳市', province: '河南' },
  { value: '101181401', label: '周口市', province: '河南' },
  { value: '101181501', label: '漯河市', province: '河南' },
  { value: '101181601', label: '驻马店市', province: '河南' },
  { value: '101181701', label: '三门峡市', province: '河南' },
  { value: '101181801', label: '济源市', province: '河南' },

  // ==================== 湖北省 ====================
  { value: '101200101', label: '武汉市', province: '湖北' },
  { value: '101200201', label: '襄阳市', province: '湖北' },
  { value: '101200301', label: '鄂州市', province: '湖北' },
  { value: '101200401', label: '孝感市', province: '湖北' },
  { value: '101200501', label: '黄冈市', province: '湖北' },
  { value: '101200601', label: '黄石市', province: '湖北' },
  { value: '101200701', label: '咸宁市', province: '湖北' },
  { value: '101200801', label: '荆州市', province: '湖北' },
  { value: '101200901', label: '宜昌市', province: '湖北' },
  { value: '101201001', label: '恩施土家族苗族自治州', province: '湖北' },
  { value: '101201101', label: '十堰市', province: '湖北' },
  { value: '101201201', label: '神农架林区', province: '湖北' },
  { value: '101201301', label: '随州市', province: '湖北' },
  { value: '101201401', label: '荆门市', province: '湖北' },
  { value: '101201501', label: '天门市', province: '湖北' },
  { value: '101201601', label: '仙桃市', province: '湖北' },
  { value: '101201701', label: '潜江市', province: '湖北' },

  // ==================== 湖南省 ====================
  { value: '101250101', label: '长沙市', province: '湖南' },
  { value: '101250201', label: '湘潭市', province: '湖南' },
  { value: '101250301', label: '株洲市', province: '湖南' },
  { value: '101250401', label: '衡阳市', province: '湖南' },
  { value: '101250501', label: '郴州市', province: '湖南' },
  { value: '101250601', label: '常德市', province: '湖南' },
  { value: '101250701', label: '益阳市', province: '湖南' },
  { value: '101250801', label: '娄底市', province: '湖南' },
  { value: '101250901', label: '邵阳市', province: '湖南' },
  { value: '101251001', label: '岳阳市', province: '湖南' },
  { value: '101251101', label: '张家界市', province: '湖南' },
  { value: '101251201', label: '怀化市', province: '湖南' },
  { value: '101251301', label: '永州市', province: '湖南' },
  { value: '101251401', label: '湘西土家族苗族自治州', province: '湖南' },

  // ==================== 广东省 ====================
  { value: '101280101', label: '广州市', province: '广东' },
  { value: '101280201', label: '韶关市', province: '广东' },
  { value: '101280301', label: '惠州市', province: '广东' },
  { value: '101280401', label: '梅州市', province: '广东' },
  { value: '101280501', label: '汕头市', province: '广东' },
  { value: '101280601', label: '深圳市', province: '广东' },
  { value: '101280701', label: '珠海市', province: '广东' },
  { value: '101280800', label: '佛山市', province: '广东' },
  { value: '101280901', label: '肇庆市', province: '广东' },
  { value: '101281001', label: '湛江市', province: '广东' },
  { value: '101281101', label: '江门市', province: '广东' },
  { value: '101281201', label: '河源市', province: '广东' },
  { value: '101281301', label: '清远市', province: '广东' },
  { value: '101281401', label: '云浮市', province: '广东' },
  { value: '101281501', label: '潮州市', province: '广东' },
  { value: '101281601', label: '东莞市', province: '广东' },
  { value: '101281701', label: '中山市', province: '广东' },
  { value: '101281801', label: '阳江市', province: '广东' },
  { value: '101281901', label: '揭阳市', province: '广东' },
  { value: '101282001', label: '茂名市', province: '广东' },
  { value: '101282101', label: '汕尾市', province: '广东' },

  // ==================== 广西壮族自治区 ====================
  { value: '101300101', label: '南宁市', province: '广西' },
  { value: '101300201', label: '崇左市', province: '广西' },
  { value: '101300301', label: '柳州市', province: '广西' },
  { value: '101300401', label: '来宾市', province: '广西' },
  { value: '101300501', label: '桂林市', province: '广西' },
  { value: '101300601', label: '梧州市', province: '广西' },
  { value: '101300701', label: '贺州市', province: '广西' },
  { value: '101300801', label: '贵港市', province: '广西' },
  { value: '101300901', label: '玉林市', province: '广西' },
  { value: '101301001', label: '百色市', province: '广西' },
  { value: '101301101', label: '钦州市', province: '广西' },
  { value: '101301201', label: '河池市', province: '广西' },
  { value: '101301301', label: '北海市', province: '广西' },
  { value: '101301401', label: '防城港市', province: '广西' },

  // ==================== 海南省 ====================
  { value: '101310101', label: '海口市', province: '海南' },
  { value: '101310201', label: '三亚市', province: '海南' },
  { value: '101310202', label: '三沙市', province: '海南' },
  { value: '101310203', label: '儋州市', province: '海南' },

  // ==================== 四川省 ====================
  { value: '101270101', label: '成都市', province: '四川' },
  { value: '101270201', label: '攀枝花市', province: '四川' },
  { value: '101270301', label: '自贡市', province: '四川' },
  { value: '101270401', label: '绵阳市', province: '四川' },
  { value: '101270501', label: '南充市', province: '四川' },
  { value: '101270601', label: '达州市', province: '四川' },
  { value: '101270701', label: '遂宁市', province: '四川' },
  { value: '101270801', label: '广安市', province: '四川' },
  { value: '101270901', label: '巴中市', province: '四川' },
  { value: '101271001', label: '泸州市', province: '四川' },
  { value: '101271101', label: '宜宾市', province: '四川' },
  { value: '101271201', label: '内江市', province: '四川' },
  { value: '101271301', label: '资阳市', province: '四川' },
  { value: '101271401', label: '乐山市', province: '四川' },
  { value: '101271501', label: '眉山市', province: '四川' },
  { value: '101271601', label: '凉山彝族自治州', province: '四川' },
  { value: '101271701', label: '雅安市', province: '四川' },
  { value: '101271801', label: '甘孜藏族自治州', province: '四川' },
  { value: '101271901', label: '阿坝藏族羌族自治州', province: '四川' },
  { value: '101272001', label: '德阳市', province: '四川' },
  { value: '101272101', label: '广元市', province: '四川' },

  // ==================== 贵州省 ====================
  { value: '101260101', label: '贵阳市', province: '贵州' },
  { value: '101260201', label: '遵义市', province: '贵州' },
  { value: '101260301', label: '安顺市', province: '贵州' },
  { value: '101260401', label: '黔南布依族苗族自治州', province: '贵州' },
  { value: '101260501', label: '黔东南苗族侗族自治州', province: '贵州' },
  { value: '101260601', label: '铜仁市', province: '贵州' },
  { value: '101260701', label: '毕节市', province: '贵州' },
  { value: '101260801', label: '六盘水市', province: '贵州' },
  { value: '101260901', label: '黔西南布依族苗族自治州', province: '贵州' },

  // ==================== 云南省 ====================
  { value: '101290101', label: '昆明市', province: '云南' },
  { value: '101290201', label: '大理白族自治州', province: '云南' },
  { value: '101290301', label: '红河哈尼族彝族自治州', province: '云南' },
  { value: '101290401', label: '曲靖市', province: '云南' },
  { value: '101290501', label: '保山市', province: '云南' },
  { value: '101290601', label: '文山壮族苗族自治州', province: '云南' },
  { value: '101290701', label: '玉溪市', province: '云南' },
  { value: '101290801', label: '楚雄彝族自治州', province: '云南' },
  { value: '101290901', label: '普洱市', province: '云南' },
  { value: '101291001', label: '临沧市', province: '云南' },
  { value: '101291101', label: '昭通市', province: '云南' },
  { value: '101291201', label: '丽江市', province: '云南' },
  { value: '101291301', label: '德宏傣族景颇族自治州', province: '云南' },
  { value: '101291401', label: '怒江傈僳族自治州', province: '云南' },
  { value: '101291501', label: '迪庆藏族自治州', province: '云南' },
  { value: '101291601', label: '西双版纳傣族自治州', province: '云南' },

  // ==================== 西藏自治区 ====================
  { value: '101140101', label: '拉萨市', province: '西藏' },
  { value: '101140201', label: '日喀则市', province: '西藏' },
  { value: '101140301', label: '山南市', province: '西藏' },
  { value: '101140401', label: '林芝市', province: '西藏' },
  { value: '101140501', label: '昌都市', province: '西藏' },
  { value: '101140601', label: '那曲市', province: '西藏' },
  { value: '101140701', label: '阿里地区', province: '西藏' },

  // ==================== 陕西省 ====================
  { value: '101110101', label: '西安市', province: '陕西' },
  { value: '101110201', label: '咸阳市', province: '陕西' },
  { value: '101110301', label: '延安市', province: '陕西' },
  { value: '101110401', label: '榆林市', province: '陕西' },
  { value: '101110501', label: '渭南市', province: '陕西' },
  { value: '101110601', label: '商洛市', province: '陕西' },
  { value: '101110701', label: '安康市', province: '陕西' },
  { value: '101110801', label: '汉中市', province: '陕西' },
  { value: '101110901', label: '宝鸡市', province: '陕西' },
  { value: '101111001', label: '铜川市', province: '陕西' },

  // ==================== 甘肃省 ====================
  { value: '101160101', label: '兰州市', province: '甘肃' },
  { value: '101160201', label: '定西市', province: '甘肃' },
  { value: '101160301', label: '平凉市', province: '甘肃' },
  { value: '101160401', label: '庆阳市', province: '甘肃' },
  { value: '101160501', label: '武威市', province: '甘肃' },
  { value: '101160601', label: '金昌市', province: '甘肃' },
  { value: '101160701', label: '张掖市', province: '甘肃' },
  { value: '101160801', label: '酒泉市', province: '甘肃' },
  { value: '101160901', label: '天水市', province: '甘肃' },
  { value: '101161001', label: '陇南市', province: '甘肃' },
  { value: '101161101', label: '临夏回族自治州', province: '甘肃' },
  { value: '101161201', label: '甘南藏族自治州', province: '甘肃' },
  { value: '101161301', label: '白银市', province: '甘肃' },
  { value: '101161401', label: '嘉峪关市', province: '甘肃' },

  // ==================== 青海省 ====================
  { value: '101150101', label: '西宁市', province: '青海' },
  { value: '101150201', label: '海东市', province: '青海' },
  { value: '101150301', label: '黄南藏族自治州', province: '青海' },
  { value: '101150401', label: '海南藏族自治州', province: '青海' },
  { value: '101150501', label: '果洛藏族自治州', province: '青海' },
  { value: '101150601', label: '玉树藏族自治州', province: '青海' },
  { value: '101150701', label: '海西蒙古族藏族自治州', province: '青海' },
  { value: '101150801', label: '海北藏族自治州', province: '青海' },

  // ==================== 宁夏回族自治区 ====================
  { value: '101170101', label: '银川市', province: '宁夏' },
  { value: '101170201', label: '石嘴山市', province: '宁夏' },
  { value: '101170301', label: '吴忠市', province: '宁夏' },
  { value: '101170401', label: '固原市', province: '宁夏' },
  { value: '101170501', label: '中卫市', province: '宁夏' },

  // ==================== 新疆维吾尔自治区 ====================
  { value: '101130101', label: '乌鲁木齐市', province: '新疆' },
  { value: '101130201', label: '克拉玛依市', province: '新疆' },
  { value: '101130301', label: '石河子市', province: '新疆' },
  { value: '101130401', label: '昌吉回族自治州', province: '新疆' },
  { value: '101130501', label: '吐鲁番市', province: '新疆' },
  { value: '101130601', label: '巴音郭楞蒙古自治州', province: '新疆' },
  { value: '101130701', label: '阿克苏地区', province: '新疆' },
  { value: '101130801', label: '喀什地区', province: '新疆' },
  { value: '101130901', label: '伊犁哈萨克自治州', province: '新疆' },
  { value: '101131001', label: '塔城地区', province: '新疆' },
  { value: '101131101', label: '哈密市', province: '新疆' },
  { value: '101131201', label: '和田地区', province: '新疆' },
  { value: '101131301', label: '阿勒泰地区', province: '新疆' },
  { value: '101131401', label: '克孜勒苏柯尔克孜自治州', province: '新疆' },
  { value: '101131501', label: '博尔塔拉蒙古自治州', province: '新疆' },

  // ==================== 特别行政区 ====================

  // 香港
  { value: '101320101', label: '香港', province: '香港' },

  // 澳门
  { value: '101330101', label: '澳门', province: '澳门' },

  // ==================== 台湾省 ====================
  { value: '101340101', label: '台北市', province: '台湾' },
  { value: '101340201', label: '高雄市', province: '台湾' },
  { value: '101340401', label: '台中市', province: '台湾' },
]

/**
 * 将城市数据转换为 SearchableSelect 组件所需的格式
 * 返回 { id: 城市代码, name: "省份 - 城市名" } 格式的数组
 * @returns SearchableSelect 兼容的选项数组
 */
export function getCitySelectOptions(): Array<{ id: string; name: string }> {
  return cityOptions.map((city) => ({
    id: city.value,
    name: `${city.province} - ${city.label}`,
  }))
}

/**
 * 根据城市代码查找城市名称
 * @param code 城市代码（如 '101010100'）
 * @returns 城市名称，未找到返回 undefined
 */
export function getCityNameByCode(code: string): string | undefined {
  const city = cityOptions.find((c) => c.value === code)
  return city?.label
}
