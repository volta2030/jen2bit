[![npm version](https://img.shields.io/npm/v/jen2bit)](https://www.npmjs.com/package/jen2bit)
[![npm downloads](https://img.shields.io/npm/dm/jen2bit)](https://www.npmjs.com/package/jen2bit)
[![license](https://img.shields.io/npm/l/jen2bit)](https://www.npmjs.com/package/jen2bit)

### What is jen2bit

> npm package for cli jenkinsfile to bitbucket-pipeline .yml file

### Install

```bash
npm install -g jen2bit
```

### Commands

#### convert

##### descriptions

- Convert Jenkins file to bitbucket pipeline yml file

##### grammars

```
jen2bit convert [Jenkinsfile] [options]
```

##### options

| option | description | default |
|--------|-------------|---------|
| `-o, --output <file>` | Output file path | `bitbucket-pipelines.yml` |
| `-r, --runner <runners...>` | Runner labels for `default-runner`. Labels containing `windows` → Windows mode, otherwise Linux mode | - |

##### examples

```bash
# Use default runner (defaults to Linux mode)
jen2bit convert Jenkinsfile

# Linux runner (auto-detected from label)
jen2bit convert Jenkinsfile -r self.hosted linux

# Windows self-hosted runner
jen2bit convert Jenkinsfile -r self.hosted windows

# Specify output file
jen2bit convert Jenkinsfile -o my-pipeline.yml
```

##### output

```
bitbucket-pipelines.yml
```