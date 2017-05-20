#!/bin/bash

if [[ $# != 1 ]];then
    echo "Usage: ./make_dict.sh file.json"
    exit 1
fi

file="dict.json"
cp $1 file
# 处理scrapy爬取到的json数组
sed -i "/^\[/d" $file
sed -i "/^\]/d" $file
sed -i "s/,$//" $file

# 生成html文件
python make_dict.py

# 制作字典
kindlegen Ancient_Chinese_Dict.opf
