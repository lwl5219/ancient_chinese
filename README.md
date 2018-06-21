
# 关于

使用Scrapy框架爬取[汉语言文学网](http://wyw.hwxnet.com/)文言文字典,使用抓取到的数据制作成Kindle字典.

下面目录结构中列出的文件是运行爬虫和字典生成最终产生的文件,如果懒得爬取可以直接使用下述文件: 

+ Ancient_Chinese_Dict.mobi		kindle字典
+ ancient_chinese.mongodb		爬取结果的mongodb备份
+ ancient_chinese.json	爬取的json结果


```
├── ancient_chinese_dict
│   ├── Ancient_Chinese_Dict.mobi
└── dict
    ├── out_file
    │   ├── ancient_chinese.json
    │   └── ancient_chinese.mongodb
```

# 依赖

+ scrapy
+ kindlegen

kindlegen 下载地址:https://www.amazon.com/gp/feature.html?ie=UTF8&docId=1000765211

Mac 下可通过 brew 安装:

```
brew install kindlegen
```

scrapy 安装参见: https://docs.scrapy.org/en/latest/intro/install.html

# 使用

## 爬取

进入 __dict__ 目录,执行命令:

```
scrapy crawl guhanyu -o out_file/ancient_chinese.json
```

将爬取的结果保存成json文件,由于爬取耗时比较长,建议后台运行:

```
nohup scrapy crawl guhanyu -o out_file/ancient_chinese.json scrapy.log 2>&1 &
```

## 制作Kindle字典

将爬取的 `ancient_chinese.json` 文件拷贝到 __ancient_chinese_dict__ 目录,执行:

```
sh make_dict.sh
```

可生成Kindle字典 `Ancient_Chinese_Dict.mobi`


# 感谢

[自制 Kindle 字典简明教程（入门篇）](https://kindlefere.com/post/161.html)

[自制 Kindle 字典简明教程（进阶篇）](https://kindlefere.com/post/178.html)

