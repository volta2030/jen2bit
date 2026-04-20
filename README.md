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
| `-r, --runner <runners...>` | Runner labels added as `runs-on` in each step. Labels containing `windows` → Windows mode, otherwise Linux mode | - |
| `-a, --all` | Merge all stages into a single step | - |

##### examples

```bash
# No runner specified (Linux mode, no runs-on)
jen2bit convert Jenkinsfile

# Linux self-hosted runner
jen2bit convert Jenkinsfile -r self.hosted linux

# Windows self-hosted runner
jen2bit convert Jenkinsfile -r self.hosted windows

# Merge all stages into a single step
jen2bit convert Jenkinsfile -a

# Combine with runner
jen2bit convert Jenkinsfile -a -r self.hosted linux

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

| option | description | default |
|--------|-------------|---------|
| `-o, --output <file>` | Output file path | `Jenkinsfile` |

##### examples

```bash
# Default (reads bitbucket-pipelines.yml, outputs Jenkinsfile)
jen2bit invert

# Specify input file
jen2bit invert my-pipeline.yml

# Specify output file
jen2bit invert bitbucket-pipelines.yml -o MyJenkinsfile
```

##### output

```
Jenkinsfile
```

```
major.minor.patch
```
- minor : Add or Delete commands
- patch : Edit commands 

### Dependencies

| package | description |
|---------|-------------|
| `commander` | CLI framework for parsing commands and options |
| `js-yaml` | YAML parser used to read `bitbucket-pipelines.yml` in the `invert` command |
