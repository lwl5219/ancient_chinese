#!/usr/bin/env python
# encoding: utf-8

import sys

headstr = '''
<html>

<head>
    <!-- 指定文件编码为 UTF-8 -->
    <meta http-equiv="content-type" content="text/html; charset=utf-8" />
</head>

<body>

    <div>
        <!-- 添加封面图片，注意确保路径正确 -->
        <p><img src="images/cover.png" width="100%" height="100%" alt="cover" /></p>
    </div>

    <mbp:pagebreak/><!-- 分页符 -->

        <!-- 字典扉页。不需要也可以忽略这一块内容 -->
        <h2 align="center">《古汉语常用字字典》</h2>
        <br/>
        <p><b>&nbsp;&nbsp;本字典共收录古汉语常用字3900余个，古今意义相同而且现代汉语中也很常用的字，古书中很少出现的生僻字和意义，古白话和现代汉语中才出现的字和意义，以及诗词曲中特有的意义一般不收。并酌收少量的双音词，约2500多个。可查询日常古籍里汉字的拼音、词性及详细解释，是学习古代汉语和阅读古籍的好工具。</b></p>
        <br/>
        <p><b>制   作:天宝佳缘</b></p>

    <!-- 起始位置标记 -->
    <a id="filepos1" />
'''

endstr = '''
    <mbp:pagebreak/>

</body>
</html>
'''

def trans_index(idx):
    idxdic = { '①'.decode('utf-8') : 1, '②'.decode('utf-8') : 2, '③'.decode('utf-8') : 3, '④'.decode('utf-8') : 4,
        '⑤'.decode('utf-8') : 5, '⑥'.decode('utf-8') : 6, '⑦'.decode('utf-8') : 7, '⑧'.decode('utf-8') : 8,
        '⑨'.decode('utf-8') : 9, '⑩'.decode('utf-8') : 10, '⑾'.decode('utf-8') : 11, '⑿'.decode('utf-8') : 12,
        '⒀'.decode('utf-8') : 13, '⒁'.decode('utf-8') : 14, '⒂'.decode('utf-8') : 15, '⒃'.decode('utf-8') : 16,
        '⒄'.decode('utf-8') : 17, '⒅'.decode('utf-8') : 18, '⒆'.decode('utf-8') : 19, '⒇'.decode('utf-8') : 20 }
    if (idxdic.has_key(idx)):
        return idxdic[idx]
    else:
        return 0


def make_dict(srcfile, outfile):
    with open(srcfile, 'r') as fp:
        # 获取所有词
        allexplains = []
        for line in fp.readlines():
            wddict = eval(line);
            allexplains.append(wddict)

        # 格式化后写入文件
        with open(outfile, 'w') as outfp:
            outfp.write(headstr)
            outfp.write("\t<mbp:frameset>\n")
            outfp.write("\t\t<hr/>\n")
            for word in allexplains:
                outstr = word_format(word)
                outfp.write(str(outstr))
            outfp.write("\t</mbp:frameset>\n")
            outfp.write(endstr)


def word_format(wordinfo):
    word = wordinfo['word']
    explain = wordinfo['explain']
    outstr = ""
    count = len(explain)
    idx = 0
    for spell in explain:
        outstr += "\t\t<idx:entry scriptable=\"yes\">\n"
        outstr += "\t\t\t<idx:orth value=\"{0}\">\n".format(word)
        outstr += "\t\t\t</idx:orth>\n"
        idx += 1
        if ( 1 == count ):
            outstr += "\t\t\t<b><word homo_no=\"{0}\">{1}</word></b>\n".format(idx, word)
        else:
            outstr += "\t\t\t<b><word homo_no=\"{0}\">{1}<sup>{2}</sup></word></b>\n".format(idx, word, idx)
        outstr += "\t\t\t<br/>\n"
        outstr += "\t\t\t<phonetic>{0}</phonetic>\n".format(spell)
        outstr += explain_format(explain[spell])
        outstr += "\t\t</idx:entry>\n"
        outstr += "\t\t<hr/>\n"
    return outstr


# 单词释义
def explain_format(explain):
    outstr = "\t\t\t<category>\n"
    outstr += "\t\t\t\t<br/>\n"
    lastidx = 0
    sense_end = "\t\t\t\t</sense>\n\t\t\t\t<br/>\n"
    sense = ""
    for line in explain:
        if (line == ''):
            continue
        exidx = trans_index(line.decode('utf-8')[0:1])
        if ( 0 != exidx ):
            if (0 != lastidx):
                sense += sense_end

            sense += "\t\t\t\t<sense>\n"
            sense += "\t\t\t\t\t<description>{0}</description>\n".format(line)
            lastidx = exidx
        else:
            sense += "\t\t\t\t\t<br/>\n"
            sense += "\t\t\t\t\t<description>{0}</description>\n".format(line)
            #  sense += "\t\t\t\t\t<example>\n"
            #  sense += "\t\t\t\t\t\t<source>{0}</source>\n".format(line)
            #  sense += "\t\t\t\t\t</example>\n"
    sense += sense_end
    outstr += sense
    outstr += "\t\t\t</category>\n"
    return outstr


if __name__ == "__main__":
    reload(sys)
    sys.setdefaultencoding('utf8')
    make_dict("./ancient_chinese.json", "./Ancient_Chinese_Dict.html")
