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
| `-r, --runner <runners...>` | Runner labels for `default-runner` | - |

##### examples

```bash
# Use default runner
jen2bit convert Jenkinsfile

# Use custom runner labels
jen2bit convert Jenkinsfile -r self.hosted linux

# Specify output file
jen2bit convert Jenkinsfile -o my-pipeline.yml
```

##### output

```
bitbucket-pipelines.yml
```