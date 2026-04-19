[![npm version](https://img.shields.io/npm/v/jen2bit)](https://www.npmjs.com/package/jen2bit)
[![npm downloads](https://img.shields.io/npm/dm/jen2bit)](https://www.npmjs.com/package/jen2bit)
[![license](https://img.shields.io/npm/l/jen2bit)](https://www.npmjs.com/package/jen2bit)

### What is jen2bit

> A CLI for Jenkinsfile to bitbucket-pipeline.yml

### Install

```bash
npm install -g jen2bit
```

### Commands

#### convert

##### descriptions

- Convert Jenkinsfile to bitbucket-pipelines.yml

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


#### invert

##### descriptions

- Invert bitbucket-pipelines.yml to Jenkinsfile

##### grammars

```
jen2bit invert [bitbucket-pipelines.yml] [options]
```

##### options

### Dependencies

| package | description |
|---------|-------------|
| `commander` | CLI framework for parsing commands and options |
| `js-yaml` | YAML parser used to read `bitbucket-pipelines.yml` in the `invert` command |
